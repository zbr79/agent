module.exports = {
  apps: [
    {
      name: "inschat",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3001",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "inschat-agent",
      script: "/home/ubuntu/opencode-tmp/agent/start-server.sh",
      interpreter: "bash",
      cwd: "/home/ubuntu/opencode-tmp/agent",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
