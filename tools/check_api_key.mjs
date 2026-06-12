import { requireEnv } from "./env.mjs";

const apiKey = requireEnv("ER_API_KEY");

console.log(`ER_API_KEY is configured (${apiKey.length} characters).`);
