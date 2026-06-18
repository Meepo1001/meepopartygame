module.exports = {
  apps: [
    {
      name: "meepopartygame",
      script: "server.mjs",
      cwd: "/opt/meepopartygame",
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "4174",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
    },
  ],
};
