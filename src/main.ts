import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig(Deno.env.toObject())
const app = createApp()

Deno.serve({ port: config.port }, app.fetch)
