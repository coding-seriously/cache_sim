const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const WEBSITE_DIR = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(__dirname, '.runtime');
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_PIN_PATH = '/home/sqln/Documents/labtest4_2024csb1151_2024csb1153/pin_tool/pin';
const DEFAULT_PIN_TOOL_SO = '/home/sqln/Documents/labtest4_2024csb1151_2024csb1153/pin_tool/source/tools/ManualExamples/obj-intel64/memtrace2.so';

async function ensureRuntimeDir() {
    await fsp.mkdir(RUNTIME_DIR, { recursive: true });
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let total = 0;
        let body = '';

        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            body += chunk.toString('utf8');
        });

        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function runCommand(command, args, options = {}) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: options.cwd || PROJECT_ROOT,
            env: { ...process.env, ...(options.env || {}) },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        if (options.stdin) {
            child.stdin.write(options.stdin);
            child.stdin.end();
        }

        child.stdout.on('data', (data) => {
            stdout += data.toString('utf8');
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString('utf8');
        });

        child.on('error', (error) => {
            resolve({
                code: -1,
                stdout,
                stderr: `${stderr}\n${error.message}`.trim(),
                command: `${command} ${args.join(' ')}`
            });
        });

        child.on('close', (code) => {
            resolve({
                code,
                stdout,
                stderr,
                command: `${command} ${args.join(' ')}`
            });
        });
    });
}

function parseAddress(addressToken) {
    const trimmed = addressToken.trim();
    if (/^0x/i.test(trimmed)) {
        return Number.parseInt(trimmed, 16);
    }
    const asDecimal = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(asDecimal)) {
        return asDecimal;
    }
    return Number.NaN;
}

function normalizeTrace(raw) {
    const out = [];
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) {
            continue;
        }

        const op = parts[0].toUpperCase();
        if (op !== 'R' && op !== 'W') {
            continue;
        }

        const addrValue = parseAddress(parts[1]);
        if (Number.isNaN(addrValue)) {
            continue;
        }

        const addrHex = `0x${addrValue.toString(16)}`;
        out.push(`${op} ${addrHex}`);
    }

    return out.join('\n');
}

function sendJson(res, statusCode, payload) {
    const data = JSON.stringify(payload, null, 2);
    res.writeHead(statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data)
    });
    res.end(data);
}

function serveStatic(req, res) {
    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const cleanPath = path.normalize(urlPath).replace(/^\/+/, '');
    const filePath = path.join(WEBSITE_DIR, cleanPath);

    if (!filePath.startsWith(WEBSITE_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mime = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8'
        }[ext] || 'text/plain; charset=utf-8';

        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);
    });
}

function toIntOrDefault(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function runPipeline(payload) {
    const cppCode = typeof payload.cppCode === 'string' ? payload.cppCode : '';
    if (!cppCode.trim()) {
        return { ok: false, error: 'C++ code is empty.' };
    }

    await ensureRuntimeDir();

    const sourcePath = path.join(RUNTIME_DIR, 'input.cpp');
    const binaryPath = path.join(RUNTIME_DIR, 'input_program');
    const tracePath = path.join(PROJECT_ROOT, 'memtrace.out');

    const cacheSizeKB = toIntOrDefault(payload.cacheSizeKB, 64);
    const blockSize = toIntOrDefault(payload.blockSize, 4);
    const associativity = toIntOrDefault(payload.associativity, 2);
    const policy = toIntOrDefault(payload.policy, 0);
    const returnPolicy = toIntOrDefault(payload.returnPolicy, 0);
    const programArgs = typeof payload.programArgs === 'string' ? payload.programArgs.trim() : '';

    const pinPath = (typeof payload.pinPath === 'string' && payload.pinPath.trim())
        ? payload.pinPath.trim()
        : (process.env.PIN_PATH || DEFAULT_PIN_PATH);

    const pinToolPath = (typeof payload.pinToolPath === 'string' && payload.pinToolPath.trim())
        ? payload.pinToolPath.trim()
        : (process.env.PIN_TOOL_SO || DEFAULT_PIN_TOOL_SO);

    await fsp.writeFile(sourcePath, cppCode, 'utf8');

    try {
        await fsp.unlink(tracePath);
    } catch (_) {
        // Ignore missing old trace.
    }

    const compileProgram = await runCommand('g++', [sourcePath, '-O0', '-g', '-o', binaryPath], {
        cwd: PROJECT_ROOT
    });

    if (compileProgram.code !== 0) {
        return {
            ok: false,
            step: 'compile-program',
            compileProgram
        };
    }

    const pinArgs = ['-t', pinToolPath, '--', binaryPath];
    if (programArgs) {
        pinArgs.push(...programArgs.split(/\s+/));
    }

    const runPin = await runCommand(pinPath, pinArgs, { cwd: PROJECT_ROOT });
    if (runPin.code !== 0) {
        return {
            ok: false,
            step: 'run-pin',
            compileProgram,
            runPin,
            hint: 'Verify pin path and tool .so path. You can set them in the form or via PIN_PATH / PIN_TOOL_SO env vars.'
        };
    }

    let rawTrace = '';
    try {
        rawTrace = await fsp.readFile(tracePath, 'utf8');
    } catch (error) {
        return {
            ok: false,
            step: 'read-trace',
            compileProgram,
            runPin,
            error: `Trace file not found at ${tracePath}: ${error.message}`
        };
    }

    const normalizedTrace = normalizeTrace(rawTrace);
    if (!normalizedTrace.trim()) {
        return {
            ok: false,
            step: 'normalize-trace',
            compileProgram,
            runPin,
            error: 'Trace file exists, but no valid R/W trace lines were found.'
        };
    }

    const compileCacheSim = await runCommand('g++', ['main.cpp', 'cache.cpp', 'policies.cpp', '-o', 'cache_sim'], {
        cwd: PROJECT_ROOT
    });

    if (compileCacheSim.code !== 0) {
        return {
            ok: false,
            step: 'compile-cache-sim',
            compileProgram,
            runPin,
            compileCacheSim
        };
    }

    const cacheInput = `${cacheSizeKB}\n${blockSize}\n${associativity}\n${policy}\n${returnPolicy}\nmemtrace.out\n`;

    const runCacheSim = await runCommand('./cache_sim', [], {
        cwd: PROJECT_ROOT,
        stdin: cacheInput
    });

    if (runCacheSim.code !== 0) {
        return {
            ok: false,
            step: 'run-cache-sim',
            compileProgram,
            runPin,
            compileCacheSim,
            runCacheSim
        };
    }

    return {
        ok: true,
        config: {
            cacheSizeKB,
            blockSize,
            associativity,
            policy,
            returnPolicy
        },
        tools: {
            compileProgram,
            runPin,
            compileCacheSim,
            runCacheSim
        },
        trace: normalizedTrace
    };
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/api/run') {
        try {
            const body = await readRequestBody(req);
            const payload = JSON.parse(body || '{}');
            const result = await runPipeline(payload);
            sendJson(res, result.ok ? 200 : 400, result);
        } catch (error) {
            sendJson(res, 500, {
                ok: false,
                error: error.message
            });
        }
        return;
    }

    if (req.method === 'GET') {
        serveStatic(req, res);
        return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
});

server.listen(PORT, HOST, () => {
    console.log(`Cache visualizer server running on ${HOST}:${PORT}`);
    if (HOST === '0.0.0.0') {
        console.log(`Open: http://127.0.0.1:${PORT}`);
    }
});
