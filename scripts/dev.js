const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const REDIS_HOST = '127.0.0.1';
const REDIS_PORT = 6379;
const root = path.join(__dirname, '..');
const redisDir = path.join(root, '.local', 'redis');
const redisServer = path.join(redisDir, 'redis-server.exe');
const redisConf = path.join(redisDir, 'redis.windows.conf');

function isRedisUp() {
    return new Promise((resolve) => {
        const socket = net.connect({ host: REDIS_HOST, port: REDIS_PORT });
        socket.setTimeout(500);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => resolve(false));
    });
}

async function ensureRedis() {
    if (await isRedisUp()) {
        console.log('Redis already running on 127.0.0.1:6379');
        return;
    }
    if (!fs.existsSync(redisServer)) {
        console.error('Local Redis not found at .local/redis/redis-server.exe');
        process.exit(1);
    }

    const child = spawn(redisServer, [redisConf, '--bind', REDIS_HOST, '--port', String(REDIS_PORT)], {
        cwd: redisDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    child.unref();

    for (let i = 0; i < 25; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (await isRedisUp()) {
            console.log('Started local Redis on 127.0.0.1:6379');
            return;
        }
    }

    console.error('Failed to start local Redis on 127.0.0.1:6379');
    process.exit(1);
}

(async () => {
    process.env.NODE_ENV = 'dev';
    process.env.REDIS_HOST = REDIS_HOST;
    process.env.REDIS_PORT = String(REDIS_PORT);
    process.env.REDIS_PASSWORD = '';

    await ensureRedis();

    const nodemonBin = path.join(root, 'node_modules', 'nodemon', 'bin', 'nodemon.js');
    const child = spawn(process.execPath, [nodemonBin, '--inspect', '--trace-warnings', 'index.js'], {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
    });
    child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        else process.exit(code ?? 0);
    });
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
