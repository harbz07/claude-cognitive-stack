module.exports = {
  apps: [
    {
      name: 'cognitive-runtime',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=cognitive-runtime-production --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        MASTER_KEY: 'dev-master-key',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
}
