import React from 'react';
import ImageGenerator from '../ImageGenerator';
import { User } from '../../types';

interface HDImageGeneratorProps {
    user: User | null;
    onUpdateUser: (updates: Partial<User>) => void;
}

const HDImageGenerator: React.FC<HDImageGeneratorProps> = ({ user, onUpdateUser }) => {
    return (
        <div>
            <ImageGenerator user={user} onUpdateUser={onUpdateUser} />
        </div>
    );
};

export default HDImageGenerator;
