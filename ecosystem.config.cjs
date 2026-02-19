module.exports = {
  apps: [
    {
      name: 'cognitive-runtime',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=cognitive-runtime-production --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        OPENAI_API_KEY: 'gsk-eyJjb2dlbl9pZCI6ImI4YWY5ZTQ5LWUxM2YtNGRiZC1iZjJiLThhNThkZGYxNDI2MyIsImtleV9pZCI6ImJjYmU2ODUwLTc4MWYtNGQzMy1hNTNjLWQzNzIyNTYwODAwMiIsImN0aW1lIjoxNzcxNDYwNjk4LCJjbGF1ZGVfYmlnX21vZGVsIjpudWxsLCJjbGF1ZGVfbWlkZGxlX21vZGVsIjpudWxsLCJjbGF1ZGVfc21hbGxfbW9kZWwiOm51bGx9fFMgdMbW-CLhKOOtOtgIb9DdIaZ76fWPND7GFVi3gyal',
        OPENAI_BASE_URL: 'https://www.genspark.ai/api/llm_proxy/v1',
        MASTER_KEY: 'dev-master-key',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
}
