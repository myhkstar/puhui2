# --- 阶段 1: 构建前端 ---
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# 执行 package.json 中的 build 脚本 (tsc && vite build)
RUN npm run build 

# --- 阶段 2: 运行后端 ---
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
# 只安装生产环境依赖
RUN npm install --only=production
# 从构建阶段复制生成的 dist 文件夹和 server.js
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js

# 设置环境变量
ENV PORT=3000
EXPOSE 3000

# 启动服务器
CMD ["node", "server.js"]
