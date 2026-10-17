module.exports = {
  apps: [{
    name: "lunar-bot",
    script: "./index.js",
    restart_delay: 3000,
    max_restarts: 100,
    env: {
      NODE_ENV: "production"
    }
  }]
};
