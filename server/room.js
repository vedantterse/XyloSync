export class RoomManager {
    constructor(supabase) {
        this.supabase = supabase;
    }

    async getUserRooms(username) {
        try {
            // List all folders in uploads
            const { data, error } = await this.supabase.storage
                .from('uploads')
                .list('');

            if (error) throw error;

            // Filter and map folders that start with username_
            const userRooms = data
                .filter(item => item.name.startsWith(`${username}_`))
                .map(item => {
                    const roomCode = item.name.split('_')[1];
                    return {
                        roomCode,
                        folderPath: `uploads/${item.name}`,
                        owner: username
                    };
                });

            console.log('Found rooms for user:', username, userRooms);
            return userRooms;
        } catch (error) {
            console.error('Error getting user rooms:', error);
            throw error;
        }
    }

    async createRoom(username) {
        try {
            const existingRooms = await this.getUserRooms(username);
            console.log('Existing rooms:', existingRooms.length);

            if (existingRooms.length >= 5) {
                throw new Error('Maximum room limit (5) reached');
            }

            const roomCode = Math.floor(10000 + Math.random() * 90000).toString();
            const folderPath = `${username}_${roomCode}`;

            // Create folder with marker
            const { error: folderError } = await this.supabase.storage
                .from('uploads')
                .upload(`${folderPath}/.folder`, new Uint8Array(0), {
                    upsert: true
                });

            if (folderError) throw folderError;

            const roomData = {
                success: true,
                roomCode,
                folderPath: `uploads/${folderPath}`,
                owner: username
            };

            return roomData;
        } catch (error) {
            console.error('Error creating room:', error);
            throw error;
        }
    }

    async joinRoom(roomCode) {
        try {
            const { data, error } = await this.supabase.storage
                .from('uploads')
                .list('');

            if (error) throw error;

            const roomFolder = data.find(item => item.name.includes(`_${roomCode}`));
            if (!roomFolder) {
                throw new Error('Room not found');
            }

            // Extract owner from folder name (username_roomcode)
            const owner = roomFolder.name.split('_')[0];
            
            return {
                success: true,
                roomCode,
                folderPath: `uploads/${roomFolder.name}`,
                owner: owner // Ensure owner is always included
            };
        } catch (error) {
            console.error('Error joining room:', error);
            throw error;
        }
    }

    async deleteRoom(roomCode) {
        try {
            const { data, error } = await this.supabase.storage
                .from('uploads')
                .list('');

            if (error) throw error;

            // Find the room folder
            const roomFolder = data.find(item => item.name.includes(`_${roomCode}`));
            if (!roomFolder) {
                throw new Error('Room not found');
            }

            // List all files in the room folder
            const { data: files, error: listError } = await this.supabase.storage
                .from('uploads')
                .list(roomFolder.name);

            if (listError) throw listError;

            // Delete all files in the folder first
            if (files && files.length > 0) {
                const filePaths = files.map(file => `${roomFolder.name}/${file.name}`);
                const { error: deleteFilesError } = await this.supabase.storage
                    .from('uploads')
                    .remove(filePaths);

                if (deleteFilesError) throw deleteFilesError;
            }

            // Finally delete the folder itself
            const { error: deleteFolderError } = await this.supabase.storage
                .from('uploads')
                .remove([`${roomFolder.name}/.folder`]);

            if (deleteFolderError) throw deleteFolderError;

            return { success: true };
        } catch (error) {
            console.error('Error deleting room:', error);
            throw error;
        }
    }
} 