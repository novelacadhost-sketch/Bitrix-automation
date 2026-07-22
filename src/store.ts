import fs from 'node:fs';
import path from 'node:path';

// A tiny JSON-file-backed store. We use this (instead of just keeping data
// in memory) because on some hosts - notably cPanel's Passenger-managed Node
// apps - the server process can be recycled after a period of idleness.
// Losing registered OAuth clients or issued access/refresh tokens on every
// restart would force you to reconnect Claude constantly, so we persist
// them to a small JSON file on disk instead. This is intentionally simple
// (no database) since this server has exactly one user.

export class JsonStore<T extends object> {
    private readonly filePath: string;
    private data: T;

    constructor(fileName: string, defaultValue: T, dataDir: string) {
        fs.mkdirSync(dataDir, { recursive: true });
        this.filePath = path.join(dataDir, fileName);
        this.data = this.load(defaultValue);
    }

    private load(defaultValue: T): T {
        try {
            const raw = fs.readFileSync(this.filePath, 'utf8');
            return { ...defaultValue, ...JSON.parse(raw) };
        } catch {
            return { ...defaultValue };
        }
    }

    private persist(): void {
        // Write to a temp file then rename, so a crash mid-write can never
        // leave a corrupted/half-written store file behind.
        const tmpPath = `${this.filePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(tmpPath, this.filePath);
    }

    get<K extends keyof T>(key: K): T[K] {
        return this.data[key];
    }

    set<K extends keyof T>(key: K, value: T[K]): void {
        this.data[key] = value;
        this.persist();
    }
}
