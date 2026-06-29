const runBtn = document.getElementById('runBtn');
const stepBtn = document.getElementById('stepBtn');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const statusBox = document.getElementById('status');
const gridEl = document.getElementById('grid');
const layoutEl = document.getElementById('layout');
const leftSplitterEl = document.getElementById('leftSplitter');
const rightSplitterEl = document.getElementById('rightSplitter');
const openGraphBtn = document.getElementById('openGraphBtn');
const traceLineEl = document.getElementById('traceLine');
const traceMetaEl = document.getElementById('traceMeta');
const speedEl = document.getElementById('speed');
const graphModeEl = document.getElementById('graphMode');
const graphCanvasEl = document.getElementById('graphCanvas');
const accessTypeBoxEl = document.getElementById('accessTypeBox');
const hitCountEl = document.getElementById('hitCount');
const missCountEl = document.getElementById('missCount');
const hitChipEl = document.getElementById('hitChip');
const missChipEl = document.getElementById('missChip');
const ACCESS_TYPE_CLASSES = [
    'access-type-idle',
    'access-type-hit',
    'access-type-insert',
    'access-type-miss',
    'access-type-miss-evict',
    'access-type-miss-writeback',
    'access-type-pulse'
];

function getApiEndpoint() {
    const isBackendHost = window.location.hostname === '127.0.0.1' && window.location.port === '8080';
    return isBackendHost ? '/api/run' : 'http://127.0.0.1:8080/api/run';
}

const MAX_RENDERED_SETS = 128;
const GRAPH_STORAGE_KEY = 'cache-sim-graph-data';
const LAYOUT_STORAGE_KEY = 'cache-sim-layout-widths';
const DEFAULT_LEFT_PANEL_WIDTH = 360;
const DEFAULT_RIGHT_PANEL_WIDTH = 300;
const MIN_PANEL_WIDTH = 260;
const MIN_CENTER_WIDTH = 320;
const SPLITTER_WIDTH = 8;

let simState = null;
let events = [];
let cursor = 0;
let timer = null;
let cellEls = [];
let playSpeedMs = Number.parseInt(speedEl.value, 10) || 350;
let hitCount = 0;
let missCount = 0;
let graphSeries = [];
let leftPanelWidth = DEFAULT_LEFT_PANEL_WIDTH;
let rightPanelWidth = DEFAULT_RIGHT_PANEL_WIDTH;

const GRAPH_STYLES = {
    hit: {
        color: '#58a6ff',
        fill: 'rgba(88, 166, 255, 0.14)'
    },
    miss: {
        color: '#f85149',
        fill: 'rgba(248, 81, 73, 0.14)'
    }
};

function setStatus(text) {
    statusBox.textContent = text;
}

function summarizeNonJsonResponse(response, rawText) {
    const contentType = response.headers.get('content-type') || '(missing)';
    const preview = (rawText || '').slice(0, 1200);
    return [
        `Request failed: server did not return JSON.`,
        `HTTP ${response.status} ${response.statusText}`,
        `Content-Type: ${contentType}`,
        '',
        'Response preview:',
        preview || '(empty response body)'
    ].join('\n');
}

function clearFlashes(cell) {
    cell.classList.remove('flash-entry', 'flash-exit', 'flash-writeback', 'flash-hit');
}

function clearHitHighlights() {
    for (const row of cellEls) {
        for (const cell of row) {
            if (cell) {
                cell.classList.remove('hit');
            }
        }
    }
}

function getCurrentSpeed() {
    const value = Number.parseInt(speedEl.value, 10);
    return Number.isFinite(value) ? value : 350;
}

function renderCounters() {
    if (hitCountEl) {
        hitCountEl.textContent = String(hitCount);
    }
    if (missCountEl) {
        missCountEl.textContent = String(missCount);
    }
}

function safeParseJson(rawText, fallback) {
    try {
        return JSON.parse(rawText);
    } catch (_) {
        return fallback;
    }
}

function loadLayoutWidths() {
    if (!window.localStorage) {
        return;
    }

    const rawText = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!rawText) {
        return;
    }

    const data = safeParseJson(rawText, null);
    if (!data) {
        return;
    }

    if (Number.isFinite(data.left)) {
        leftPanelWidth = data.left;
    }
    if (Number.isFinite(data.right)) {
        rightPanelWidth = data.right;
    }
}

function saveLayoutWidths() {
    if (!window.localStorage) {
        return;
    }

    try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
            left: leftPanelWidth,
            right: rightPanelWidth
        }));
    } catch (_) {
        // Ignore storage quota failures.
    }
}

function getLayoutWidth() {
    return layoutEl ? layoutEl.getBoundingClientRect().width : window.innerWidth;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function normalizePanelWidths(nextLeft, nextRight) {
    const totalWidth = Math.max(0, getLayoutWidth() - (SPLITTER_WIDTH * 2));
    const maxCombined = Math.max(MIN_PANEL_WIDTH * 2, totalWidth - MIN_CENTER_WIDTH);
    let left = Math.max(MIN_PANEL_WIDTH, nextLeft);
    let right = Math.max(MIN_PANEL_WIDTH, nextRight);

    if (left + right > maxCombined) {
        const overflow = left + right - maxCombined;
        if (left >= right) {
            left = Math.max(MIN_PANEL_WIDTH, left - overflow);
        } else {
            right = Math.max(MIN_PANEL_WIDTH, right - overflow);
        }
    }

    if (left + right > maxCombined) {
        const scale = maxCombined / Math.max(1, left + right);
        left = Math.max(MIN_PANEL_WIDTH, Math.floor(left * scale));
        right = Math.max(MIN_PANEL_WIDTH, Math.floor(right * scale));
    }

    return {
        left,
        right
    };
}

function applyPanelWidths(nextLeft = leftPanelWidth, nextRight = rightPanelWidth) {
    const normalized = normalizePanelWidths(nextLeft, nextRight);
    leftPanelWidth = normalized.left;
    rightPanelWidth = normalized.right;

    document.documentElement.style.setProperty('--left-panel-width', `${leftPanelWidth}px`);
    document.documentElement.style.setProperty('--right-panel-width', `${rightPanelWidth}px`);
}

function saveGraphSnapshot() {
    if (!window.localStorage) {
        return;
    }

    try {
        localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify({
            version: 1,
            updatedAt: Date.now(),
            totalInstructions: graphSeries.length,
            hitCount,
            missCount,
            series: graphSeries
        }));
    } catch (_) {
        // Ignore storage quota failures.
    }
}

function clearGraphSnapshot() {
    if (!window.localStorage) {
        return;
    }

    try {
        localStorage.removeItem(GRAPH_STORAGE_KEY);
    } catch (_) {
        // Ignore storage failures.
    }
}

function initResizablePanels() {
    loadLayoutWidths();
    applyPanelWidths(leftPanelWidth, rightPanelWidth);

    const bindSplitter = (splitterEl, side) => {
        if (!splitterEl) {
            return;
        }

        const onMouseMove = (event) => {
            const layoutWidth = getLayoutWidth();
            const maxLeftWidth = Math.max(MIN_PANEL_WIDTH, layoutWidth - rightPanelWidth - MIN_CENTER_WIDTH - (SPLITTER_WIDTH * 2));
            const maxRightWidth = Math.max(MIN_PANEL_WIDTH, layoutWidth - leftPanelWidth - MIN_CENTER_WIDTH - (SPLITTER_WIDTH * 2));

            if (side === 'left') {
                const nextLeft = clamp(leftPanelWidth + (event.clientX - startX), MIN_PANEL_WIDTH, maxLeftWidth);
                applyPanelWidths(nextLeft, rightPanelWidth);
            } else {
                const nextRight = clamp(rightPanelWidth + (startX - event.clientX), MIN_PANEL_WIDTH, maxRightWidth);
                applyPanelWidths(leftPanelWidth, nextRight);
            }
        };

        let startX = 0;

        const onMouseUp = () => {
            document.body.classList.remove('is-resizing-panels');
            splitterEl.classList.remove('dragging');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            saveLayoutWidths();
        };

        splitterEl.addEventListener('mousedown', (event) => {
            event.preventDefault();
            startX = event.clientX;
            document.body.classList.add('is-resizing-panels');
            splitterEl.classList.add('dragging');
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    };

    bindSplitter(leftSplitterEl, 'left');
    bindSplitter(rightSplitterEl, 'right');

    window.addEventListener('resize', () => {
        applyPanelWidths(leftPanelWidth, rightPanelWidth);
    });
}

function openGraphPage() {
    window.open('graph.html', '_blank', 'noopener');
}

function buildGraphSeries(eventsList) {
    const points = [];
    let hits = 0;
    let misses = 0;

    eventsList.forEach((evt, index) => {
        if (evt.eventType === 'hit') {
            hits += 1;
        } else {
            misses += 1;
        }

        const instructionNo = index + 1;
        const total = instructionNo || 1;

        points.push({
            instructionNo,
            hitCount: hits,
            missCount: misses,
            hitPercent: (hits / total) * 100,
            missPercent: (misses / total) * 100
        });
    });

    return points;
}

function getGraphMode() {
    return graphModeEl ? graphModeEl.value : 'counts';
}

function getGraphDataForMode(mode) {
    const lastPoint = graphSeries.length ? graphSeries[graphSeries.length - 1] : null;

    if (!graphSeries.length) {
        return {
            title: 'No graph data available',
            lines: [],
            yMax: 1,
            yLabel: 'Value',
            valueFormat: (value) => String(value),
            showPercentScale: false
        };
    }

    if (mode === 'hits') {
        return {
            title: 'Hit count by instruction',
            lines: [{ key: 'hitCount', label: 'Hit', style: GRAPH_STYLES.hit }],
            yMax: Math.max(1, ...graphSeries.map((point) => point.hitCount)),
            yLabel: 'Hit count',
            valueFormat: (value) => String(Math.round(value)),
            showPercentScale: false
        };
    }

    if (mode === 'misses') {
        return {
            title: 'Miss count by instruction',
            lines: [{ key: 'missCount', label: 'Miss', style: GRAPH_STYLES.miss }],
            yMax: Math.max(1, ...graphSeries.map((point) => point.missCount)),
            yLabel: 'Miss count',
            valueFormat: (value) => String(Math.round(value)),
            showPercentScale: false
        };
    }

    if (mode === 'percentages') {
        return {
            title: 'Hit and miss percentage by instruction',
            lines: [
                { key: 'hitPercent', label: 'Hit %', style: GRAPH_STYLES.hit },
                { key: 'missPercent', label: 'Miss %', style: GRAPH_STYLES.miss }
            ],
            yMax: 100,
            yLabel: 'Percentage',
            valueFormat: (value) => `${Math.round(value)}%`,
            showPercentScale: true
        };
    }

    return {
        title: 'Hits and misses by instruction',
        lines: [
            { key: 'hitCount', label: 'Hit', style: GRAPH_STYLES.hit },
            { key: 'missCount', label: 'Miss', style: GRAPH_STYLES.miss }
        ],
        yMax: Math.max(1, lastPoint ? Math.max(lastPoint.hitCount, lastPoint.missCount) : 1),
        yLabel: 'Count',
        valueFormat: (value) => String(Math.round(value)),
        showPercentScale: false
    };
}

function drawGraph() {
    if (!graphCanvasEl) {
        return;
    }

    const ctx = graphCanvasEl.getContext('2d');
    if (!ctx) {
        return;
    }

    const width = graphCanvasEl.clientWidth || 640;
    const height = graphCanvasEl.clientHeight || 260;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));

    if (graphCanvasEl.width !== pixelWidth || graphCanvasEl.height !== pixelHeight) {
        graphCanvasEl.width = pixelWidth;
        graphCanvasEl.height = pixelHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const mode = getGraphMode();
    const graphData = getGraphDataForMode(mode);
    const points = graphSeries;

    ctx.fillStyle = '#0b1016';
    ctx.fillRect(0, 0, width, height);

    const padding = {
        top: 20,
        right: 18,
        bottom: 34,
        left: graphData.showPercentScale ? 42 : 36
    };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);
    const originX = padding.left;
    const originY = height - padding.bottom;
    const xStep = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;

    ctx.strokeStyle = 'rgba(48, 54, 61, 0.9)';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8b949e';

    const tickCount = points.length > 0 ? Math.min(6, points.length) : 1;
    for (let tick = 0; tick <= tickCount; tick += 1) {
        const ratio = tickCount === 0 ? 0 : tick / tickCount;
        const x = originX + plotWidth * ratio;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, originY);
        ctx.strokeStyle = 'rgba(48, 54, 61, 0.35)';
        ctx.stroke();

        if (points.length) {
            const labelIndex = Math.min(points.length - 1, Math.round((points.length - 1) * ratio));
            const label = String(points[labelIndex].instructionNo);
            const textWidth = ctx.measureText(label).width;
            ctx.fillText(label, x - textWidth / 2, originY + 16);
        }
    }

    const yTickCount = graphData.showPercentScale ? 5 : 4;
    for (let tick = 0; tick <= yTickCount; tick += 1) {
        const ratio = yTickCount === 0 ? 0 : tick / yTickCount;
        const y = originY - plotHeight * ratio;
        ctx.beginPath();
        ctx.moveTo(originX, y);
        ctx.lineTo(width - padding.right, y);
        ctx.strokeStyle = 'rgba(48, 54, 61, 0.35)';
        ctx.stroke();

        const value = graphData.yMax * ratio;
        const label = graphData.valueFormat(value);
        ctx.fillStyle = '#6e7681';
        ctx.fillText(label, 8, y + 3);
    }

    ctx.fillStyle = '#8b949e';
    ctx.fillText('Instructions', width / 2 - 34, height - 8);
    ctx.save();
    ctx.translate(12, height / 2 + 20);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(graphData.yLabel, 0, 0);
    ctx.restore();

    if (!points.length) {
        ctx.fillStyle = '#6e7681';
        ctx.textAlign = 'center';
        ctx.fillText('Run the simulation to populate the graph.', width / 2, height / 2);
        ctx.textAlign = 'left';
        return;
    }

    const yScale = plotHeight / Math.max(1, graphData.yMax);
    graphData.lines.forEach((line) => {
        const series = points.map((point, index) => ({
            x: originX + index * xStep,
            y: originY - (point[line.key] * yScale)
        }));

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(series[0].x, originY);
        series.forEach((point, index) => {
            if (index === 0) {
                ctx.lineTo(point.x, point.y);
            } else {
                ctx.lineTo(point.x, point.y);
            }
        });
        ctx.lineTo(series[series.length - 1].x, originY);
        ctx.closePath();
        ctx.fillStyle = line.style.fill;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = line.style.color;
        series.forEach((point, index) => {
            if (index === 0) {
                ctx.moveTo(point.x, point.y);
            } else {
                ctx.lineTo(point.x, point.y);
            }
        });
        ctx.stroke();

        series.forEach((point) => {
            ctx.beginPath();
            ctx.fillStyle = line.style.color;
            ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    });

    const markerIndex = Math.min(cursor, points.length - 1);
    if (markerIndex >= 0 && points[markerIndex]) {
        const markerX = originX + markerIndex * xStep;
        ctx.save();
        ctx.strokeStyle = 'rgba(88, 166, 255, 0.85)';
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(markerX, padding.top);
        ctx.lineTo(markerX, originY);
        ctx.stroke();
        ctx.restore();
    }
}

function renderGraph() {
    drawGraph();
}

function resetCounters() {
    hitCount = 0;
    missCount = 0;
    renderCounters();
    if (hitChipEl) {
        hitChipEl.classList.remove('counter-active-hit');
    }
    if (missChipEl) {
        missChipEl.classList.remove('counter-active-miss');
    }
}

function updateCounterHighlight(evt) {
    if (hitChipEl) {
        hitChipEl.classList.remove('counter-active-hit');
    }
    if (missChipEl) {
        missChipEl.classList.remove('counter-active-miss');
    }

    if (evt.eventType === 'hit') {
        if (hitChipEl) {
            void hitChipEl.offsetWidth;
            hitChipEl.classList.add('counter-active-hit');
        }
        return;
    }

    if (missChipEl) {
        void missChipEl.offsetWidth;
        missChipEl.classList.add('counter-active-miss');
    }
}

function setAccessTypeIdle(text) {
    if (!accessTypeBoxEl) {
        return;
    }
    accessTypeBoxEl.classList.remove(...ACCESS_TYPE_CLASSES);
    accessTypeBoxEl.classList.add('access-type-idle');
    accessTypeBoxEl.textContent = text;
}

function updateAccessTypeBox(evt) {
    if (!accessTypeBoxEl) {
        return;
    }

    let label = 'Miss';
    let cls = 'access-type-miss';

    if (evt.eventType === 'hit') {
        label = 'Hit';
        cls = 'access-type-hit';
    } else if (!evt.evicted && !evt.writeback) {
        label = 'New Block';
        cls = 'access-type-insert';
    } else if (evt.writeback) {
        label = 'Miss / Write-back';
        cls = 'access-type-miss-writeback';
    } else if (evt.evicted) {
        label = 'Miss / Evict';
        cls = 'access-type-miss-evict';
    }

    accessTypeBoxEl.classList.remove(...ACCESS_TYPE_CLASSES);
    accessTypeBoxEl.classList.add(cls);
    accessTypeBoxEl.textContent = `Instruction ${evt.lineNo}: ${label}`;

    // Restart pulse animation on every step.
    void accessTypeBoxEl.offsetWidth;
    accessTypeBoxEl.classList.add('access-type-pulse');
}

function parseTrace(trace) {
    const out = [];
    const lines = trace.split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const [opRaw, addrRaw] = line.split(/\s+/);
        if (!opRaw || !addrRaw) continue;

        const op = opRaw.toUpperCase();
        if (op !== 'R' && op !== 'W') continue;

        const addr = Number.parseInt(addrRaw, 16);
        if (!Number.isFinite(addr)) continue;

        out.push({
            op,
            addr,
            text: `${op} 0x${addr.toString(16)}`
        });
    }

    return out;
}

function createEmptyCache(config) {
    const cacheSizeBytes = config.cacheSizeKB * 1024;
    const numSets = Math.floor(cacheSizeBytes / (config.blockSize * config.associativity));
    const sets = [];

    for (let s = 0; s < numSets; s += 1) {
        const lines = [];
        for (let w = 0; w < config.associativity; w += 1) {
            lines.push({
                valid: false,
                dirty: false,
                tag: 0,
                lastAccessTime: 0,
                loadTime: 0
            });
        }
        sets.push(lines);
    }

    return {
        sets,
        numSets,
        associativity: config.associativity,
        blockSize: config.blockSize,
        policy: config.policy,
        currentTime: 0
    };
}

function chooseLine(state, setLines) {
    for (let i = 0; i < setLines.length; i += 1) {
        if (!setLines[i].valid) return i;
    }

    if (state.policy === 0) {
        let oldest = setLines[0].lastAccessTime;
        let idx = 0;
        for (let i = 1; i < setLines.length; i += 1) {
            if (setLines[i].lastAccessTime < oldest) {
                oldest = setLines[i].lastAccessTime;
                idx = i;
            }
        }
        return idx;
    }

    if (state.policy === 1) {
        let oldest = setLines[0].loadTime;
        let idx = 0;
        for (let i = 1; i < setLines.length; i += 1) {
            if (setLines[i].loadTime < oldest) {
                oldest = setLines[i].loadTime;
                idx = i;
            }
        }
        return idx;
    }

    return Math.floor(Math.random() * setLines.length);
}

function touchLine(state, line) {
    if (state.policy === 0) {
        state.currentTime += 1;
        line.lastAccessTime = state.currentTime;
    }
}

function loadLine(state, line) {
    state.currentTime += 1;
    if (state.policy === 0) {
        line.lastAccessTime = state.currentTime;
    } else if (state.policy === 1) {
        line.loadTime = state.currentTime;
    }
}

function buildEvents(trace, config) {
    const parsed = parseTrace(trace);
    const state = createEmptyCache(config);

    if (state.numSets <= 0) {
        throw new Error('Invalid cache setup: number of sets is 0.');
    }

    if ((state.numSets & (state.numSets - 1)) !== 0) {
        throw new Error('Number of sets must be power-of-two for this simulator.');
    }

    const offsetBits = Math.log2(state.blockSize);
    const indexBits = Math.log2(state.numSets);

    if (!Number.isInteger(offsetBits) || !Number.isInteger(indexBits)) {
        throw new Error('Block size and num sets must be powers of two.');
    }

    const generated = [];

    parsed.forEach((item, i) => {
        const maskedAddress = item.addr & 262143;
        const setIdx = (maskedAddress >> offsetBits) & (state.numSets - 1);
        const tag = maskedAddress >> (offsetBits + indexBits);
        const setLines = state.sets[setIdx];

        let hitIdx = -1;
        for (let lineIdx = 0; lineIdx < setLines.length; lineIdx += 1) {
            if (setLines[lineIdx].valid && setLines[lineIdx].tag === tag) {
                hitIdx = lineIdx;
                break;
            }
        }

        if (hitIdx >= 0) {
            const line = setLines[hitIdx];
            if (item.op === 'W') {
                line.dirty = true;
            }
            touchLine(state, line);
            generated.push({
                lineNo: i + 1,
                text: item.text,
                op: item.op,
                setIdx,
                lineIdx: hitIdx,
                eventType: 'hit',
                writeback: false,
                evicted: false
            });
            return;
        }

        const victimIdx = chooseLine(state, setLines);
        const victim = setLines[victimIdx];
        const evicted = victim.valid;
        const writeback = victim.valid && victim.dirty;

        victim.tag = tag;
        victim.valid = true;
        victim.dirty = item.op === 'W';
        loadLine(state, victim);

        generated.push({
            lineNo: i + 1,
            text: item.text,
            op: item.op,
            setIdx,
            lineIdx: victimIdx,
            eventType: 'insert',
            writeback,
            evicted
        });
    });

    return {
        events: generated,
        numSets: state.numSets,
        associativity: state.associativity
    };
}

function buildGrid(numSets, associativity) {
    const renderSets = Math.min(numSets, MAX_RENDERED_SETS);
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${associativity}, minmax(70px, 1fr))`;

    cellEls = Array.from({ length: renderSets }, () => Array(associativity).fill(null));

    for (let s = 0; s < renderSets; s += 1) {
        for (let w = 0; w < associativity; w += 1) {
            const cell = document.createElement('div');
            cell.className = 'cache-cell';
            cell.textContent = `S${s} W${w}`;
            gridEl.appendChild(cell);
            cellEls[s][w] = cell;
        }
    }

    return renderSets;
}

function applyEvent(evt) {
    traceLineEl.textContent = `Line ${evt.lineNo}: ${evt.text} | Set ${evt.setIdx}, Way ${evt.lineIdx}`;
    updateAccessTypeBox(evt);
    clearHitHighlights();

    if (evt.setIdx >= cellEls.length) {
        return;
    }

    const cell = cellEls[evt.setIdx][evt.lineIdx];
    if (!cell) {
        return;
    }

    clearFlashes(cell);

    if (evt.evicted) {
        cell.classList.add('flash-exit');
    }

    if (evt.writeback) {
        cell.classList.add('flash-writeback');
    }

    if (evt.eventType === 'hit') {
        cell.classList.add('hit');
        cell.classList.add('flash-hit');
    } else {
        cell.classList.add('flash-entry');
    }

    cell.classList.add('valid');
}

function step() {
    if (!events.length) {
        return;
    }
    if (cursor >= events.length) {
        stopPlay();
        return;
    }
    const evt = events[cursor];
    applyEvent(evt);
    if (evt.eventType === 'hit') {
        hitCount += 1;
    } else {
        missCount += 1;
    }
    renderCounters();
    updateCounterHighlight(evt);
    renderGraph();
    cursor += 1;
}

function stopPlay() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

function startPlayTimer() {
    stopPlay();
    playSpeedMs = getCurrentSpeed();
    timer = setInterval(() => {
        step();
        if (cursor >= events.length) {
            stopPlay();
        }
    }, playSpeedMs);
}

function play() {
    startPlayTimer();
}

async function runPipeline() {
    stopPlay();
    setStatus('Running compile + pin + cache_sim ...');
    traceLineEl.textContent = '-';
    setAccessTypeIdle('Running simulation...');
    resetCounters();

    const payload = {
        cacheSizeKB: Number.parseInt(document.getElementById('cacheSizeKB').value, 10),
        blockSize: Number.parseInt(document.getElementById('blockSize').value, 10),
        associativity: Number.parseInt(document.getElementById('associativity').value, 10),
        policy: Number.parseInt(document.getElementById('policy').value, 10),
        returnPolicy: Number.parseInt((document.getElementById('returnPolicy') || { value: '0' }).value, 10),
        pinPath: document.getElementById('pinPath').value,
        pinToolPath: document.getElementById('pinToolPath').value,
        programArgs: document.getElementById('programArgs').value,
        cppCode: document.getElementById('cppCode').value
    };

    try {
        const response = await fetch(getApiEndpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const rawText = await response.text();
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        let data = null;

        if (rawText.trim()) {
            if (contentType.includes('application/json')) {
                try {
                    data = JSON.parse(rawText);
                } catch (error) {
                    setStatus(
                        [
                            `Request failed: invalid JSON from server.`,
                            `HTTP ${response.status} ${response.statusText}`,
                            `Error: ${error.message}`,
                            '',
                            'Response preview:',
                            rawText.slice(0, 1200)
                        ].join('\n')
                    );
                    traceMetaEl.textContent = 'Request failed.';
                    return;
                }
            } else {
                setStatus(summarizeNonJsonResponse(response, rawText));
                traceMetaEl.textContent = 'Request failed.';
                return;
            }
        } else {
            setStatus(
                [
                    'Request failed: empty response body.',
                    `HTTP ${response.status} ${response.statusText}`
                ].join('\n')
            );
            traceMetaEl.textContent = 'Request failed.';
            return;
        }

        if (!response.ok || !data.ok) {
            setStatus(JSON.stringify(data, null, 2));
            traceMetaEl.textContent = 'Pipeline failed.';
            setAccessTypeIdle('Simulation failed.');
            return;
        }

        const build = buildEvents(data.trace, data.config);
        events = build.events;
        graphSeries = buildGraphSeries(events);
        saveGraphSnapshot();
        cursor = 0;

        const renderedSets = buildGrid(build.numSets, build.associativity);

        const warning = build.numSets > renderedSets
            ? `Showing first ${renderedSets} / ${build.numSets} sets.`
            : `Showing all ${build.numSets} sets.`;

        traceMetaEl.textContent = `Trace lines: ${events.length}. ${warning}`;

        setStatus(
            [
                'Pipeline complete.',
                '',
                'cache_sim output:',
                data.tools.runCacheSim.stdout || '(no output)',
                data.tools.runCacheSim.stderr ? `\ncache_sim stderr:\n${data.tools.runCacheSim.stderr}` : ''
            ].join('\n')
        );

        if (events.length > 0) {
            const firstEvent = events[0];
            applyEvent(firstEvent);
            if (firstEvent.eventType === 'hit') {
                hitCount = 1;
            } else {
                missCount = 1;
            }
            renderCounters();
            updateCounterHighlight(firstEvent);
            cursor = 1;
        } else {
            setAccessTypeIdle('No instructions found in trace.');
        }

        renderGraph();
    } catch (error) {
        setStatus(`Request failed: ${error.message}`);
        traceMetaEl.textContent = 'Request failed.';
        setAccessTypeIdle('Request failed.');
        graphSeries = [];
        clearGraphSnapshot();
        renderGraph();
    }
}

resetCounters();
initResizablePanels();

runBtn.addEventListener('click', runPipeline);
stepBtn.addEventListener('click', step);
playBtn.addEventListener('click', play);
pauseBtn.addEventListener('click', stopPlay);
if (openGraphBtn) {
    openGraphBtn.addEventListener('click', openGraphPage);
}
if (graphModeEl) {
    graphModeEl.addEventListener('change', renderGraph);
}
speedEl.addEventListener('input', () => {
    playSpeedMs = getCurrentSpeed();
    if (timer) {
        startPlayTimer();
    }
});
window.addEventListener('resize', renderGraph);

renderGraph();
