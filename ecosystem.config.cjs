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
        ROOM_PASSWORD: process.env.ROOM_PASSWORD || "",
        TRTC_SDK_APP_ID: process.env.TRTC_SDK_APP_ID || "",
        TRTC_SECRET_KEY: process.env.TRTC_SECRET_KEY || "",
        TRTC_ROOM_ID: process.env.TRTC_ROOM_ID || "1001",
        TRTC_USER_SIG_TTL: process.env.TRTC_USER_SIG_TTL || "7200",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
    },
  ],
};
