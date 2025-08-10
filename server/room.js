export class RoomManager {
    constructor(supabase) {
        this.supabase = supabase;
    }

    async getUserRooms(userId) {
        try {
            const { data, error } = await this.supabase.storage.from('uploads').list('');
            if (error) throw error;

            const userRooms = (data || [])
                .filter(item => item.name.startsWith(`${userId}_`))
                .map(item => {
                    const parts = item.name.split('_');
                    return {
                        roomCode: parts[1] || null,
                        folderPath: `uploads/${item.name}`,
                    };
                })
                .filter(room => room.roomCode);

            return userRooms;
        } catch (error) {
            console.error('Error getting user rooms:', error);
            throw new Error('Failed to retrieve user rooms.');
        }
    }

    async createRoom(username, userId) {
        try {
            // Enforce max 3 rooms per userId
            const { data: all, error: listErr } = await this.supabase.storage.from('uploads').list('');
            if (listErr) throw listErr;
            const existing = (all || []).filter(it => it.name.startsWith(`${userId}_`));
            if (existing.length >= 3) {
                return { success: false, message: 'Maximum room limit (3) reached' };
            }

            const roomCode = Math.floor(10000 + Math.random() * 90000).toString();
            const folderPath = `${userId}_${roomCode}`;

            // Create a placeholder + metadata file for owner info
            const { error: keepErr } = await this.supabase.storage
                .from('uploads')
                .upload(`${folderPath}/.keep`, new Uint8Array(0), { upsert: true });
            if (keepErr) throw keepErr;

            const meta = Buffer.from(JSON.stringify({ ownerUserId: userId, ownerUsername: username }), 'utf8');
            const { error: metaErr } = await this.supabase.storage
                .from('uploads')
                .upload(`${folderPath}/.meta.json`, meta, { upsert: true, contentType: 'application/json' });
            if (metaErr) throw metaErr;

            return {
                success: true,
                roomCode,
                folderPath: `uploads/${folderPath}`,
                owner: username
            };
        } catch (error) {
            console.error('Error creating room:', error);
            throw new Error('Failed to create room.');
        }
    }

    async joinRoom(roomCode) {
        try {
            const { data, error } = await this.supabase.storage.from('uploads').list('');
            if (error) throw error;

            const roomFolder = (data || []).find(item => item.name.endsWith(`_${roomCode}`));
            if (!roomFolder) {
                throw new Error('Room not found');
            }

            // Try to read owner username from .meta.json
            let owner = roomFolder.name.split('_')[0]; // fallback to ownerUserId
            try {
                const { data: metaBlob } = await this.supabase.storage
                    .from('uploads')
                    .download(`${roomFolder.name}/.meta.json`);
                if (metaBlob) {
                    // Blob in Node has .text(); for safety, support Buffer fallback
                    const text = typeof metaBlob.text === 'function'
                        ? await metaBlob.text()
                        : Buffer.from(await metaBlob.arrayBuffer()).toString('utf8');
                    const parsed = JSON.parse(text);
                    owner = parsed.ownerUsername || owner;
                }
            } catch {
                // ignore meta read errors; fallback to ownerUserId
            }

            return {
                success: true,
                roomCode,
                folderPath: `uploads/${roomFolder.name}`,
                owner
            };
        } catch (error) {
            console.error('Error joining room:', error);
            throw new Error('Failed to retrieve room details.');
        }
    }

    async deleteRoom(roomCode, userId) {
        try {
            const { data, error } = await this.supabase.storage.from('uploads').list('');
            if (error) throw error;

            const roomFolder = (data || []).find(item => item.name.endsWith(`_${roomCode}`));
            if (!roomFolder) throw new Error('Room not found.');

            // Authorization
            if (!roomFolder.name.startsWith(`${userId}_`)) {
                throw new Error('Unauthorized: You do not own this room.');
            }

            // Delete all files within the folder
            const { data: files, error: listError } = await this.supabase.storage.from('uploads').list(roomFolder.name);
            if (listError) throw listError;

            if (files && files.length > 0) {
                const filePaths = files.map(file => `${roomFolder.name}/${file.name}`);
                const { error: deleteFilesError } = await this.supabase.storage.from('uploads').remove(filePaths);
                if (deleteFilesError) throw deleteFilesError;
            }

            return { success: true, message: 'Room deleted successfully.' };
        } catch (error) {
            console.error('Error deleting room:', error);
            throw new Error('Failed to delete room.');
        }
    }
}