module.exports = {
  apps: [
    {
      name: 'cognitive-runtime',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=cognitive-runtime-production --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        // Set these in .dev.vars or environment — never commit secrets
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1',
        MASTER_KEY: process.env.MASTER_KEY || 'dev-master-key',
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || '',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
}

