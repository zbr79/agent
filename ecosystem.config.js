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
  ],
};
