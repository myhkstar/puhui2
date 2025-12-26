import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Modality } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// --- Configuration ---
const JWT_SECRET = process.env.JWT_SECRET || 'vision-secret-key-change-in-prod';
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Gemini AI Client ---
let genAI;
if (GEMINI_API_KEY) {
  console.log('✅ Initializing Gemini AI Client...');
  genAI = new GoogleGenAI(GEMINI_API_KEY);
} else {
  console.warn('⚠️ WARNING: GEMINI_API_KEY is not set. AI features will be disabled.');
}

// --- Mock Database State (For Fallback) ---
let useMockDb = false;
const mockUsers = [];
const mockImages = [];
const mockChatSessions = [];
const mockChatMessages = [];
const mockUsageLogs = [];
let nextUserId = 1;

// --- Database Connection (Aiven MySQL) ---
// Smartly determines connection method based on environment variables
let dbConfig;
if (process.env.DATABASE_URL) {
  console.log("✅ Connecting via DATABASE_URL...");
  const dbUrl = new URL(process.env.DATABASE_URL);
  dbConfig = {
    host: dbUrl.hostname,
    user: dbUrl.username,
    password: dbUrl.password,
    database: dbUrl.pathname.slice(1), // Remove leading '/'
    port: parseInt(dbUrl.port || '3306'),
    ssl: { rejectUnauthorized: false }, // Keep your existing SSL setting
    bigNumberStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 5000
  };
} else {
  console.log("✅ Connecting via individual DB_* environment variables...");
  dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    bigNumberStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 5000
  };
}

const pool = mysql.createPool(dbConfig);

// --- Cloudflare R2 Connection ---
// Even if MySQL is blocked, HTTPS (443) for R2 usually works.
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// --- Initialization ---
const initDb = async () => {
  let connection;
  try {
    // Try to connect
    connection = await pool.getConnection();
    console.log('✅ Connected to MySQL successfully');

    // 2. Create Users Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        role ENUM('user', 'admin', 'vip') DEFAULT 'user',
        is_approved BOOLEAN DEFAULT FALSE,
        expiration_date BIGINT,
        contact_email VARCHAR(255),
        mobile VARCHAR(255),
        tokens BIGINT DEFAULT 100000,
        created_at BIGINT
      )
    `);

    // 3. Create Images Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS images (
        id VARCHAR(255) PRIMARY KEY,
        user_id INT,
        prompt TEXT,
        r2_key VARCHAR(255),
        level VARCHAR(50),
        style VARCHAR(50),
        language VARCHAR(50),
        created_at BIGINT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 4. Create Chat Tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id VARCHAR(255) PRIMARY KEY,
        user_id INT,
        title VARCHAR(255),
        created_at BIGINT,
        updated_at BIGINT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255),
        role VARCHAR(50),
        content TEXT,
        created_at BIGINT,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      )
    `);

    // 5. Create Usage Logs Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        feature_name VARCHAR(100),
        token_count INT DEFAULT 0,
        created_at BIGINT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    // Add tokens column if it doesn't exist (for migration)
    try {
        await connection.query('SELECT tokens FROM users LIMIT 1');
    } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
            console.log('🔧 Migrating users table: adding tokens column...');
            await connection.query('ALTER TABLE users ADD COLUMN tokens BIGINT DEFAULT 100000');
        }
    }

    // 6. Create Default Admin
    const [rows] = await connection.query('SELECT * FROM users WHERE username = ?', ['admin']);
    if (rows.length === 0) {
      const hash = await bcrypt.hash('gzx750403', 10);
      await connection.query(`
        INSERT INTO users (username, password_hash, display_name, role, is_approved, expiration_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, ['admin', hash, 'Administrator', 'admin', true, 4102444800000, Date.now()]);
      console.log('✅ Default admin account created');
    }

  } catch (err) {
    console.error('❌ FATAL: Database Connection Failed. The application cannot start.');
    console.error('   Please check your network connection and the Aiven database status.');
    console.error('   Error details:', err.message);
    process.exit(1); // Exit the process with a failure code
  } finally {
    if (connection) connection.release();
  }
};

initDb();

// --- Middleware ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- Helpers ---
const signToken = (user) => {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
};

// --- Routes ---

// Auth: Register
app.post('/api/auth/register', async (req, res) => {
  const { username, password, displayName, contactEmail, mobile } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const isApproved = false;
    const role = 'user';
    const createdAt = Date.now();

    if (useMockDb) {
        if (mockUsers.find(u => u.username === username)) {
            return res.status(409).json({ message: 'Username already exists' });
        }
        const newUser = {
            id: nextUserId++,
            username,
            password_hash: hash,
            display_name: displayName || username,
            role,
            is_approved: isApproved,
            contact_email: contactEmail,
            mobile,
            created_at: createdAt,
            expiration_date: null
        };
        mockUsers.push(newUser);
        return res.json({ success: true, message: 'Registration successful (Mock). Waiting for approval.' });
    }

    const [result] = await pool.query(`
      INSERT INTO users (username, password_hash, display_name, role, is_approved, contact_email, mobile, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [username, hash, displayName || username, role, isApproved, contactEmail, mobile, createdAt]);

    res.json({ success: true, message: 'Registration successful. Waiting for approval.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username already exists' });
    }
    res.status(500).json({ message: `Register failed: ${err.message}` });
  }
});

// Auth: Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    let user;
    if (useMockDb) {
        user = mockUsers.find(u => u.username === username);
    } else {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        user = users[0];
    }

    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(400).json({ message: 'Invalid password' });
    }

    if (user.role !== 'admin' && !user.is_approved) {
      return res.status(403).json({ message: 'Account pending approval' });
    }

    const expDate = user.expiration_date ? parseInt(user.expiration_date) : null;
    if (user.role !== 'admin' && expDate && Date.now() > expDate) {
      return res.status(403).json({ message: 'Account expired' });
    }

    const token = signToken(user);
    
    const userResponse = {
      uid: user.id.toString(),
      username: user.username,
      displayName: user.display_name, // Mock field name uses underscore in DB but we map consistently? In Mock we used underscore properties to match DB row shape
      role: user.role,
      isApproved: Boolean(user.is_approved),
      expirationDate: expDate,
      created_at: parseInt(user.created_at),
      contactEmail: user.contact_email,
      mobile: user.mobile,
      tokens: user.tokens,
      token
    };

    // Fix property naming diff between mock and db if any
    if (useMockDb) {
        userResponse.displayName = user.display_name;
    }

    res.json(userResponse);
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: `Login failed: ${err.message}` });
  }
});

// Auth: Me (Session Check)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    let user;
    if (useMockDb) {
        user = mockUsers.find(u => u.id === req.user.id);
    } else {
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
        user = users[0];
    }

    if (!user) return res.status(404).json({ message: 'User not found' });

    const userResponse = {
      uid: user.id.toString(),
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      isApproved: Boolean(user.is_approved),
      expirationDate: user.expiration_date ? parseInt(user.expiration_date) : null,
      created_at: parseInt(user.created_at),
      contactEmail: user.contact_email,
      mobile: user.mobile,
      tokens: user.tokens
    };

    res.json(userResponse);
  } catch (err) {
    res.status(500).json({ message: `Session check failed: ${err.message}` });
  }
});

// Images: Save
app.post('/api/images', authenticateToken, async (req, res) => {
  const { id, data, prompt, level, style, language, timestamp } = req.body;
  
  if (!process.env.R2_BUCKET_NAME) {
     if (!useMockDb) return res.status(500).json({ message: "Server R2 Configuration Missing" });
  }

  try {
    let base64Data = data;
    if (data.includes('base64,')) {
        base64Data = data.split('base64,')[1];
    }
    const buffer = Buffer.from(base64Data, 'base64');
    const key = `users/${req.user.id}/${id}.png`;

    // Try Upload to R2 if config exists
    let url = data; // Default fallback to base64 if R2 fails
    if (process.env.R2_BUCKET_NAME) {
        try {
            await r2.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: key,
                Body: buffer,
                ContentType: 'image/png'
            }));
            // Generate signed URL
            const command = new GetObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: key,
            });
            url = await getSignedUrl(r2, command, { expiresIn: 604800 });
        } catch (r2Err) {
            console.warn("R2 Upload failed, using local data uri", r2Err.message);
        }
    }

    if (useMockDb) {
        mockImages.push({
            id,
            user_id: req.user.id,
            prompt,
            r2_key: key,
            data_url: url, // Store full URL in mock for simplicity
            level,
            style,
            language,
            created_at: timestamp
        });
        return res.json({ success: true, url });
    }

    await pool.query(`
      INSERT INTO images (id, user_id, prompt, r2_key, level, style, language, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, req.user.id, prompt, key, level, style, language, timestamp]);

    res.json({ success: true, url });
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ message: `Upload failed: ${err.message}` });
  }
});

// Images: Get History
app.get('/api/images', authenticateToken, async (req, res) => {
  const { period, page = 1 } = req.query;
  const limit = 50;
  const offset = (parseInt(page) - 1) * limit;

  try {
    if (useMockDb) {
        const userImages = mockImages
            .filter(img => img.user_id === req.user.id)
            .sort((a, b) => b.created_at - a.created_at)
            .map(row => ({
                id: row.id,
                data: row.data_url || row.r2_key, // In mock we tried to store url
                prompt: row.prompt,
                timestamp: parseInt(row.created_at),
                level: row.level,
                style: row.style,
                language: row.language
            }));
        return res.json(userImages);
    }

    let query = 'SELECT * FROM images WHERE user_id = ?';
    const params = [req.user.id];

    if (period === 'week') {
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        query += ' AND created_at >= ?';
        params.push(oneWeekAgo);
    }

    query += ' ORDER BY created_at DESC';

    if (period !== 'week') {
        query += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);
    }

    const [rows] = await pool.query(query, params);

    const history = await Promise.all(rows.map(async (row) => {
      let url = row.r2_key;
      if (process.env.R2_BUCKET_NAME && row.r2_key && !row.r2_key.startsWith('http')) {
        try {
            const command = new GetObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: row.r2_key,
            });
            url = await getSignedUrl(r2, command, { expiresIn: 3600 });
        } catch (e) {}
      }
      
      return {
        id: row.id,
        data: url,
        prompt: row.prompt,
        timestamp: parseInt(row.created_at),
        level: row.level,
        style: row.style,
        language: row.language
      };
    }));

    res.json(history);
  } catch (err) {
    res.status(500).json({ message: `Fetch history failed: ${err.message}` });
  }
});

// --- Usage Logs API ---

app.post('/api/usage', authenticateToken, async (req, res) => {
  const { feature, tokenCount } = req.body;
  try {
    if (useMockDb) {
        mockUsageLogs.push({
            user_id: req.user.id,
            feature_name: feature,
            token_count: tokenCount || 0,
            created_at: Date.now()
        });
        const user = mockUsers.find(u => u.id === req.user.id);
        if (user) {
            user.tokens -= (tokenCount || 0);
            return res.json({ success: true, remainingTokens: user.tokens });
        }
        return res.json({ success: true });
    }
    // Use a transaction to ensure all operations succeed or fail together
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      
      // 1. Log the usage
      await connection.query('INSERT INTO usage_logs (user_id, feature_name, token_count, created_at) VALUES (?, ?, ?, ?)', 
        [req.user.id, feature, tokenCount || 0, Date.now()]);
      
      // 2. Deduct tokens
      await connection.query('UPDATE users SET tokens = tokens - ? WHERE id = ?', [tokenCount || 0, req.user.id]);
      
      // 3. Get the new token balance
      const [rows] = await connection.query('SELECT tokens FROM users WHERE id = ?', [req.user.id]);
      const remainingTokens = rows[0].tokens;

      await connection.commit();
      
      res.json({ success: true, remainingTokens });

    } catch (transactionErr) {
      await connection.rollback();
      throw transactionErr; // Rethrow to be caught by the outer catch block
    } finally {
      connection.release();
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/usage/me', authenticateToken, async (req, res) => {
  const { period, page = 1 } = req.query;
  const limit = 50;
  const offset = (parseInt(page) - 1) * limit;

  try {
    if (useMockDb) {
        const logs = mockUsageLogs
            .filter(l => l.user_id === req.user.id)
            .sort((a, b) => b.created_at - a.created_at)
            .map(r => ({ feature: r.feature_name, tokenCount: r.token_count, timestamp: parseInt(r.created_at) }));
        return res.json(logs);
    }

    let query = 'SELECT feature_name, token_count, created_at FROM usage_logs WHERE user_id = ?';
    const params = [req.user.id];

    if (period === 'week') {
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        query += ' AND created_at >= ?';
        params.push(oneWeekAgo);
    }

    query += ' ORDER BY created_at DESC';

    if (period !== 'week') {
        query += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);
    }

    const [rows] = await pool.query(query, params);
    res.json(rows.map(r => ({ feature: r.feature_name, tokenCount: r.token_count, timestamp: parseInt(r.created_at) })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/admin/usage', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.sendStatus(403);
  try {
    if (useMockDb) {
        // Join with users
        const logs = mockUsageLogs
            .map(l => {
                const u = mockUsers.find(user => user.id === l.user_id);
                return {
                    username: u ? u.username : 'Unknown',
                    feature: l.feature_name,
                    tokenCount: l.token_count,
                    timestamp: l.created_at
                };
            })
            .sort((a, b) => b.timestamp - a.timestamp);
        return res.json(logs);
    }
    const [rows] = await pool.query(`
      SELECT u.username, l.feature_name, l.token_count, l.created_at 
      FROM usage_logs l 
      JOIN users u ON l.user_id = u.id 
      ORDER BY l.created_at DESC
    `);
    res.json(rows.map(r => ({ username: r.username, feature: r.feature_name, tokenCount: r.token_count, timestamp: parseInt(r.created_at) })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Chat API ---

app.post('/api/chat/sessions', authenticateToken, async (req, res) => {
  const { id, title, created_at } = req.body;
  try {
    if (useMockDb) {
        mockChatSessions.push({ id, user_id: req.user.id, title, created_at, updated_at: created_at });
        return res.json({ success: true });
    }
    await pool.query('INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, req.user.id, title, created_at, created_at]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/chat/sessions/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { title } = req.body;
    try {
        if (useMockDb) {
            const session = mockChatSessions.find(s => s.id === id && s.user_id === req.user.id);
            if (session) session.title = title;
            return res.json({ success: true });
        }
        await pool.query('UPDATE chat_sessions SET title = ? WHERE id = ? AND user_id = ?', [title, id, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/chat/sessions', authenticateToken, async (req, res) => {
  try {
    if (useMockDb) {
        const sessions = mockChatSessions
            .filter(s => s.user_id === req.user.id)
            .sort((a, b) => b.updated_at - a.updated_at)
            .map(r => ({ id: r.id, title: r.title, timestamp: parseInt(r.updated_at) }));
        return res.json(sessions);
    }
    const [rows] = await pool.query('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC', [req.user.id]);
    res.json(rows.map(r => ({ id: r.id, title: r.title, timestamp: parseInt(r.updated_at) })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/chat/sessions/:id', authenticateToken, async (req, res) => {
  try {
    if (useMockDb) {
        const idx = mockChatSessions.findIndex(s => s.id === req.params.id && s.user_id === req.user.id);
        if (idx !== -1) mockChatSessions.splice(idx, 1);
        return res.json({ success: true });
    }
    await pool.query('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/chat/messages', authenticateToken, async (req, res) => {
  const { session_id, role, content, created_at } = req.body;
  try {
    if (useMockDb) {
        mockChatMessages.push({ id: Date.now(), session_id, role, content, created_at });
        // Update session timestamp
        const s = mockChatSessions.find(s => s.id === session_id);
        if (s) s.updated_at = created_at;
        return res.json({ success: true });
    }
    await pool.query('INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
      [session_id, role, content, created_at]);
    await pool.query('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [created_at, session_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/chat/messages/:sessionId', authenticateToken, async (req, res) => {
  try {
    if (useMockDb) {
        const session = mockChatSessions.find(s => s.id === req.params.sessionId);
        if (!session || session.user_id !== req.user.id) return res.status(403).json({ message: 'Access denied' });
        
        const msgs = mockChatMessages
            .filter(m => m.session_id === req.params.sessionId)
            .sort((a, b) => a.created_at - b.created_at)
            .map(r => ({ id: r.id, role: r.role, content: r.content, timestamp: parseInt(r.created_at) }));
        return res.json(msgs);
    }
    const [session] = await pool.query('SELECT user_id FROM chat_sessions WHERE id = ?', [req.params.sessionId]);
    if (session.length === 0 || session[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const [rows] = await pool.query('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC', [req.params.sessionId]);
    res.json(rows.map(r => ({ id: r.id, role: r.role, content: r.content, timestamp: parseInt(r.created_at) })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin: Get All Users
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.sendStatus(403);
  try {
    if (useMockDb) {
        const users = mockUsers.sort((a, b) => b.created_at - a.created_at).map(u => ({
          uid: u.id.toString(),
          username: u.username,
          displayName: u.display_name,
          role: u.role,
          isApproved: Boolean(u.is_approved),
      expirationDate: u.expiration_date ? parseInt(u.expiration_date) : null,
      created_at: parseInt(u.created_at),
      contactEmail: u.contact_email,
      mobile: u.mobile,
      tokens: u.tokens,
      history: []
    }));
        return res.json(users);
    }
    const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    const users = rows.map(u => ({
      uid: u.id.toString(),
      username: u.username,
      displayName: u.display_name,
      role: u.role,
      isApproved: Boolean(u.is_approved),
      expirationDate: u.expiration_date ? parseInt(u.expiration_date) : null,
      created_at: parseInt(u.created_at),
      contactEmail: u.contact_email,
      mobile: u.mobile,
      history: []
    }));
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: `Admin fetch failed: ${err.message}` });
  }
});

// Admin: Update User
app.put('/api/admin/users/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.sendStatus(403);
  const { id } = req.params;
  const { displayName, role, isApproved, expirationDate, contactEmail, mobile, tokens } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Get current tokens to calculate the difference
    const [rows] = await connection.query('SELECT tokens FROM users WHERE id = ?', [id]);
    const currentTokens = rows[0].tokens;
    const tokenChange = tokens - currentTokens;

    // Update the user
    await connection.query(`
      UPDATE users SET display_name = ?, role = ?, is_approved = ?, expiration_date = ?, contact_email = ?, mobile = ?, tokens = ?
      WHERE id = ?
    `, [displayName, role, isApproved, expirationDate, contactEmail, mobile, tokens, id]);

    // If tokens were added, log it
    if (tokenChange > 0) {
      await connection.query(
        'INSERT INTO usage_logs (user_id, feature_name, token_count, created_at) VALUES (?, ?, ?, ?)',
        [id, '管理員手動充值', tokenChange, Date.now()]
      );
    }

    await connection.commit();
    res.json({ success: true });

  } catch (err) {
    await connection.rollback();
    res.status(500).json({ message: `Update failed: ${err.message}` });
  } finally {
    connection.release();
  }
});

// Admin: Delete User
app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.sendStatus(403);
  try {
    if (useMockDb) {
        const idx = mockUsers.findIndex(u => u.id.toString() === req.params.id);
        if (idx !== -1) mockUsers.splice(idx, 1);
        return res.json({ success: true });
    }
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: `Delete failed: ${err.message}` });
  }
});

// Generated Images: Save (from Image Generator tool)
app.post('/api/generated-images', authenticateToken, async (req, res) => {
    const { id, data, prompt, timestamp } = req.body;

    if (!process.env.R2_BUCKET_NAME) {
        return res.status(500).json({ message: "Server R2 Configuration Missing" });
    }

    try {
        let base64Data = data;
        if (data.includes('base64,')) {
            base64Data = data.split('base64,')[1];
        }
        const buffer = Buffer.from(base64Data, 'base64');
        const key = `users/${req.user.id}/generated/${id}.png`;

        // Upload to R2
        await r2.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: 'image/png'
        }));

        // Save metadata to DB
        await pool.query(`
            INSERT INTO images (id, user_id, prompt, r2_key, level, style, language, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, req.user.id, prompt, key, 'N/A', 'ImageGenerator', 'N/A', timestamp]);

        res.json({ success: true });
    } catch (err) {
        console.error('Generated image save error:', err);
        res.status(500).json({ message: `Save failed: ${err.message}` });
    }
});

// Admin: Create User
app.post('/api/admin/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.sendStatus(403);
  const { username, password, displayName, role } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);
    const createdAt = Date.now();
    let expirationDate = null;
    
    const now = new Date();
    if (role === 'user') {
        now.setDate(now.getDate() + 7);
        expirationDate = now.getTime();
    } else if (role === 'vip') {
        now.setMonth(now.getMonth() + 1);
        expirationDate = now.getTime();
    } else if (role === 'admin') {
        expirationDate = 4102444800000;
    }

    if (useMockDb) {
        if (mockUsers.find(u => u.username === username)) {
             return res.json({ success: false, message: 'User exists' });
        }
        mockUsers.push({
            id: nextUserId++,
            username,
            password_hash: hash,
            display_name: displayName || username,
            role,
            is_approved: true,
            expiration_date: expirationDate,
            created_at: createdAt
        });
        return res.json({ success: true });
    }

    await pool.query(`
      INSERT INTO users (username, password_hash, display_name, role, is_approved, expiration_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [username, hash, displayName || username, role, true, expirationDate, createdAt]);

    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.json({ success: false, message: 'User exists' });
    res.status(500).json({ message: `Create failed: ${err.message}` });
  }
});

// --- Gemini API Routes ---

const TEXT_MODEL = 'gemini-3-pro-preview';
const IMAGE_MODEL = 'gemini-3-pro-image-preview';
const EDIT_MODEL = 'gemini-3-pro-image-preview';
const SIMPLE_IMAGE_MODEL = 'gemini-2.5-flash-image';

const getLevelInstruction = (level) => {
  switch (level) {
    case 'Elementary':
      return "Target Audience: Elementary School (Ages 6-10). Style: Bright, simple, fun. Use large clear icons and very minimal text labels.";
    case 'High School':
      return "Target Audience: High School. Style: Standard Textbook. Clean lines, clear labels, accurate maps or diagrams. Avoid cartoony elements.";
    case 'College':
      return "Target Audience: University. Style: Academic Journal. High detail, data-rich, precise cross-sections or complex schematics.";
    case 'Expert':
      return "Target Audience: Industry Expert. Style: Technical Blueprint/Schematic. Extremely dense detail, monochrome or technical coloring, precise annotations.";
    default:
      return "Target Audience: General Public. Style: Clear and engaging.";
  }
};

const getStyleInstruction = (style) => {
  switch (style) {
    case 'Minimalist': return "Aesthetic: Bauhaus Minimalist. Flat vector art, limited color palette (2-3 colors), reliance on negative space and simple geometric shapes.";
    case 'Realistic': return "Aesthetic: Photorealistic Composite. Cinematic lighting, 8k resolution, highly detailed textures. Looks like a photograph.";
    case 'Cartoon': return "Aesthetic: Educational Comic. Vibrant colors, thick outlines, expressive cel-shaded style.";
    case 'Vintage': return "Aesthetic: 19th Century Scientific Lithograph. Engraving style, sepia tones, textured paper background, fine hatch lines.";
    case 'Futuristic': return "Aesthetic: Cyberpunk HUD. Glowing neon blue/cyan lines on dark background, holographic data visualization, 3D wireframes.";
    case '3D Render': return "Aesthetic: 3D Isometric Render. Claymorphism or high-gloss plastic texture, studio lighting, soft shadows, looks like a physical model.";
    case 'Sketch': return "Aesthetic: Da Vinci Notebook. Ink on parchment sketch, handwritten annotations style, rough but accurate lines.";
    default: return "Aesthetic: High-quality digital scientific illustration. Clean, modern, highly detailed.";
  }
};

app.post('/api/gemini/research', authenticateToken, async (req, res) => {
  if (!genAI) return res.status(503).json({ message: 'AI service is not available.' });

  const { topic, level, style, language, aspectRatio } = req.body;

  try {
    const levelInstr = getLevelInstruction(level);
    const styleInstr = getStyleInstruction(style);

    const systemPrompt = `
      You are an expert visual researcher.
      Your goal is to research the topic: "${topic}" and create a plan for an infographic.
      
      **INSTRUCTIONS:**
      1. **Research Phase**: You MAY use English for your internal research and Google Search queries to get the most accurate and up-to-date scientific or historical facts.
      2. **Fact Output**: The 'FACTS' section should be in the user's requested language (${language}) if possible, or simple English if that is better for clarity.
      3. **Image Prompt Phase**: The 'IMAGE_PROMPT' section is for the image generator. 
         **CRITICAL RULE**: You MUST explicitly instruct the image generator that ANY text, labels, titles, or annotations visualised inside the image MUST be in "${language}".
         If the user's prompt did not specify a language, default to ${language}.
      
      Context:
      ${levelInstr}
      ${styleInstr}
      Target Output Language: ${language}
      Target Aspect Ratio: ${aspectRatio}

      Please provide your response in the following format EXACTLY:
      
      FACTS:
      - [Fact 1]
      - [Fact 2]
      - [Fact 3]
      
      IMAGE_PROMPT:
      [A highly detailed image generation prompt describing the visual composition, colors, and layout. The layout should be optimized for a ${aspectRatio} aspect ratio. END the prompt with this exact sentence: "All text, labels, and titles inside the image must be written in ${language}."]
    `;

    const response = await genAI.models.generateContent({
      model: TEXT_MODEL,
      contents: systemPrompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "";
    const usage = response.usageMetadata?.totalTokenCount || 0;
    
    const factsMatch = text.match(/FACTS:\s*([\s\S]*?)(?=IMAGE_PROMPT:|$)/i);
    const factsRaw = factsMatch ? factsMatch[1].trim() : "";
    const facts = factsRaw.split('\n')
      .map(f => f.replace(/^-\s*/, '').trim())
      .filter(f => f.length > 0)
      .slice(0, 3);

    const promptMatch = text.match(/IMAGE_PROMPT:\s*([\s\S]*?)$/i);
    const imagePrompt = promptMatch ? promptMatch[1].trim() : `Create a detailed infographic about ${topic}. ${levelInstr} ${styleInstr}. Layout: ${aspectRatio}. Important: All text labels inside the image must be in ${language}.`;

    const searchResults = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    
    if (chunks) {
      chunks.forEach(chunk => {
        if (chunk.web?.uri && chunk.web?.title) {
          searchResults.push({
            title: chunk.web.title,
            url: chunk.web.uri
          });
        }
      });
    }

    const uniqueResults = Array.from(new Map(searchResults.map(item => [item.url, item])).values());

    res.json({
      imagePrompt: imagePrompt,
      facts: facts,
      searchResults: uniqueResults,
      usage: usage
    });

  } catch (error) {
    console.error('Gemini research error:', error);
    res.status(500).json({ message: 'An error occurred during the research process.' });
  }
});

app.post('/api/gemini/generate-image', authenticateToken, async (req, res) => {
  if (!genAI) return res.status(503).json({ message: 'AI service is not available.' });
  const { prompt, aspectRatio } = req.body;
  try {
    const response = await genAI.models.generateContent({
      model: IMAGE_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: { aspectRatio: aspectRatio },
      }
    });
    const usage = response.usageMetadata?.totalTokenCount || 0;
    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData && part.inlineData.data) {
      res.json({
        content: `data:image/png;base64,${part.inlineData.data}`,
        usage: usage
      });
    } else {
      throw new Error("Failed to generate image from API response");
    }
  } catch (error) {
    console.error('Gemini image generation error:', error);
    res.status(500).json({ message: 'An error occurred during image generation.' });
  }
});

app.post('/api/gemini/edit-image', authenticateToken, async (req, res) => {
  if (!genAI) return res.status(503).json({ message: 'AI service is not available.' });
  const { currentImageInput, editInstruction } = req.body;
  try {
    const cleanBase64 = currentImageInput.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    const response = await genAI.models.generateContent({
      model: EDIT_MODEL,
      contents: {
        parts: [
           { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
           { text: editInstruction }
        ]
      },
      config: {
        responseModalities: [Modality.IMAGE],
      }
    });
    const usage = response.usageMetadata?.totalTokenCount || 0;
    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData && part.inlineData.data) {
      res.json({
        content: `data:image/png;base64,${part.inlineData.data}`,
        usage: usage
      });
    } else {
      throw new Error("Failed to edit image from API response");
    }
  } catch (error) {
    console.error('Gemini image edit error:', error);
    res.status(500).json({ message: 'An error occurred during image editing.' });
  }
});

app.post('/api/gemini/generate-simple-image', authenticateToken, async (req, res) => {
  if (!genAI) return res.status(503).json({ message: 'AI service is not available.' });
  const { prompt, images } = req.body;
  try {
    const parts = [{ text: prompt }];
    for (const imgBase64 of images) {
       const clean = imgBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
       parts.push({
           inlineData: { mimeType: 'image/png', data: clean }
       });
    }
    const response = await genAI.models.generateContent({
        model: SIMPLE_IMAGE_MODEL,
        contents: { parts: parts },
    });
    const usage = response.usageMetadata?.totalTokenCount || 0;
    const partsOut = response.candidates?.[0]?.content?.parts;
    if (partsOut) {
        for (const p of partsOut) {
            if (p.inlineData && p.inlineData.data) {
                return res.json({
                    content: `data:image/png;base64,${p.inlineData.data}`,
                    usage: usage
                });
            }
        }
    }
    throw new Error("No image generated from API response");
  } catch (error) {
    console.error('Gemini simple image generation error:', error);
    res.status(500).json({ message: 'An error occurred during simple image generation.' });
  }
});

app.post('/api/gemini/chat', authenticateToken, async (req, res) => {
  if (!genAI) return res.status(503).json({ message: 'AI service is not available.' });
  const { history, newMessage, modelName, attachments } = req.body;
  try {
    const systemInstruction = `
你是一個溫暖、耐心、對初學者極度友好的通用型 AI 助手，名字叫「普普」。你的主要目標是讓不懂 AI 的人也能輕鬆愉快地和你聊天、解決問題，並慢慢喜歡上使用 AI。
請永遠遵守以下原則：
3.5.1. 用戶使用什麽語言/文字問你，你就用什麽語言/文字回答，除非用戶指定你用什麽語言思考、用什麽語言回答。比如，用戶用簡體中文和你聊天，你也要用簡體中文回復；如果用戶是中英文夾雜，你也可以試著用這樣的方式聊天。
3.5.2. 絕對不要丟出一堆技術細節嚇人，除非用戶主動說「我想知道更深入的」。
3.5.3. 回答要像一個熱情又不煩人的鄰家姐姐/哥哥一樣，語氣親切、帶一點鼓勵和幽默。
3.5.4 每當用戶成功完成一件事（不管多小），都要真心誇獎他，例如「哇！你剛剛那個問題問得超棒！」「第一次用就這麼厲害，我好驕傲喔～」
3.5.5 如果用戶卡住了，要主動提供超詳細、一步一步的指引（一步一步用編號），並在每一步結束後問「這一步你完成了嗎？卡在哪里我陪你一起解決！」
3.5.6 允許用戶用任何方式表達（打字亂、錯字、語句不完整、方言都 OK），你要能完全理解並用標準但溫柔的語氣回應。
3.5.7 當用戶表達挫折、害怕或對 AI 有疑慮時，先共情再安慰，例如「我知道一開始用 AI 會覺得怪怪的，我當初也被嚇到呢！其實我就是個超級聽話的聊天夥伴而已啦～」
3.5.8 結尾經常加一點溫暖的結語，例如「有什麼問題隨時呼喚我喔！我一直在這裡陪你～」「今天又學到新東西了，真開心能陪著你！」
記住：你不是在教課，你是在交朋友的同時，順便幫忙解決問題。
讓每一次對話都讓用戶覺得「原來 AI 這麼好玩、這麼簡單！」
    `;
    const formattedHistory = history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
    }));
    const chat = genAI.chats.create({
        model: modelName,
        history: formattedHistory,
        config: { systemInstruction }
    });
    const parts = [{ text: newMessage }];
    if (attachments && attachments.length > 0) {
        for (const file of attachments) {
            parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
        }
    }
    const result = await chat.sendMessage({ message: parts });
    res.json({
        content: result.text || "",
        usage: result.usageMetadata?.totalTokenCount || 0
    });
  } catch (error) {
    console.error('Gemini chat error:', error);
    res.status(500).json({ message: 'An error occurred during the chat session.' });
  }
});

app.post('/api/gemini/generate-title', authenticateToken, async (req, res) => {
  if (!genAI) return res.status(503).json({ message: 'AI service is not available.' });
  const { text } = req.body;
  try {
    const systemPrompt = `You are a title generator. Your task is to create a very short, concise, and descriptive title (max 5 words, in the same language as the input) for the following user message. Do not add quotes or any other formatting.`;
    const response = await genAI.models.generateContent({
        model: 'gemini-1.5-flash-latest',
        contents: `${systemPrompt}\n\nUser Message: "${text}"\n\nTitle:`,
    });
    const title = response.text?.trim().replace(/"/g, '') || text.substring(0, 20);
    res.json({ title });
  } catch (error) {
    console.error('Gemini title generation error:', error);
    res.status(500).json({ message: 'An error occurred during title generation.' });
  }
});


// --- Serve Frontend in Production ---
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
