// Loads .env from the current working directory into process.env, if present.
// Node's native loader (no dotenv dependency) — added in Node 20.6+.
export function loadEnv() {
    try {
        process.loadEnvFile();
    } catch {
        // No .env file — fine, rely on already-exported environment variables.
    }
}
