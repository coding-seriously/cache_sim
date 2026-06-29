const graphModeEl = document.getElementById('graphMode');
const graphCanvasEl = document.getElementById('graphCanvas');
const zoomInBtnEl = document.getElementById('zoomInBtn');
const zoomOutBtnEl = document.getElementById('zoomOutBtn');
const resetViewBtnEl = document.getElementById('resetViewBtn');
const graphPanEl = document.getElementById('graphPan');
const graphZoomLabelEl = document.getElementById('graphZoomLabel');
const graphInstructionsEl = document.getElementById('graphInstructions');
const graphHitsEl = document.getElementById('graphHits');
const graphMissesEl = document.getElementById('graphMisses');
const graphTotalEl = document.getElementById('graphTotal');
const graphUpdatedEl = document.getElementById('graphUpdated');
const graphEmptyEl = document.getElementById('graphEmpty');

const GRAPH_STORAGE_KEY = 'cache-sim-graph-data';
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

let graphSeries = [];
let graphMeta = null;
let viewStart = 0;
let viewSize = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartViewStart = 0;

const MIN_VIEW_POINTS = 12;
const ZOOM_STEP = 0.75;

function safeParseJson(rawText, fallback) {
    try {
        return JSON.parse(rawText);
    } catch (_) {
        return fallback;
    }
}

function formatTimestamp(value) {
    if (!Number.isFinite(value)) {
        return 'No data loaded';
    }

    const date = new Date(value);
    return date.toLocaleString();
}

function loadGraphData() {
    if (!window.localStorage) {
        return;
    }

    const rawText = localStorage.getItem(GRAPH_STORAGE_KEY);
    if (!rawText) {
        return;
    }

    const payload = safeParseJson(rawText, null);
    if (!payload || !Array.isArray(payload.series)) {
        return;
    }

    graphMeta = payload;
    graphSeries = payload.series.filter((point) => point && Number.isFinite(point.instructionNo));
    resetView();
}

function resetView() {
    viewStart = 0;
    viewSize = graphSeries.length;
    syncPanControl();
}

function clampView() {
    const total = graphSeries.length;
    if (!total) {
        viewStart = 0;
        viewSize = 0;
        return;
    }

    viewSize = Math.max(1, Math.min(viewSize || total, total));
    if (viewSize < MIN_VIEW_POINTS && total >= MIN_VIEW_POINTS) {
        viewSize = MIN_VIEW_POINTS;
    }

    const maxStart = Math.max(0, total - viewSize);
    viewStart = Math.max(0, Math.min(viewStart, maxStart));
}

function getVisiblePoints() {
    if (!graphSeries.length) {
        return [];
    }

    clampView();
    return graphSeries.slice(viewStart, viewStart + viewSize);
}

function syncPanControl() {
    if (!graphPanEl) {
        return;
    }

    const maxStart = Math.max(0, graphSeries.length - viewSize);
    graphPanEl.max = String(maxStart);
    graphPanEl.value = String(Math.min(viewStart, maxStart));
    graphPanEl.disabled = maxStart === 0;
}

function getEventTypeAt(index) {
    const currentPoint = graphSeries[index];
    const previousPoint = index > 0 ? graphSeries[index - 1] : null;

    if (!currentPoint) {
        return null;
    }

    if (!previousPoint) {
        return currentPoint.hitCount > 0 ? 'hit' : 'miss';
    }

    if (currentPoint.hitCount > previousPoint.hitCount) {
        return 'hit';
    }

    return 'miss';
}

function countVisibleEvents(startIndex, visiblePoints) {
    let visibleHits = 0;
    let visibleMisses = 0;

    visiblePoints.forEach((_, visibleIndex) => {
        const eventType = getEventTypeAt(startIndex + visibleIndex);
        if (eventType === 'hit') {
            visibleHits += 1;
        } else if (eventType === 'miss') {
            visibleMisses += 1;
        }
    });

    return { visibleHits, visibleMisses };
}

function updateZoomLabel() {
    if (!graphZoomLabelEl) {
        return;
    }

    const total = Math.max(1, graphSeries.length);
    const zoomPercent = Math.round((total / Math.max(1, viewSize)) * 100);
    graphZoomLabelEl.textContent = `Zoom: ${zoomPercent}%`;
}

function updateStats() {
    const visiblePoints = getVisiblePoints();
    const { visibleHits, visibleMisses } = countVisibleEvents(viewStart, visiblePoints);

    if (graphInstructionsEl) {
        graphInstructionsEl.textContent = graphSeries.length
            ? `${viewStart + 1}-${viewStart + visiblePoints.length} of ${graphSeries.length}`
            : '0';
    }
    if (graphHitsEl) {
        graphHitsEl.textContent = String(visibleHits);
    }
    if (graphMissesEl) {
        graphMissesEl.textContent = String(visibleMisses);
    }
    if (graphTotalEl) {
        const totalHits = graphMeta?.hitCount ?? 0;
        const totalMisses = graphMeta?.missCount ?? 0;
        graphTotalEl.textContent = `${graphSeries.length} instructions | ${totalHits} hits | ${totalMisses} misses`;
    }
    if (graphUpdatedEl) {
        graphUpdatedEl.textContent = formatTimestamp(graphMeta?.updatedAt);
    }
    if (graphEmptyEl) {
        graphEmptyEl.hidden = graphSeries.length > 0;
    }

    updateZoomLabel();
    syncPanControl();
}

function getGraphMode() {
    return graphModeEl ? graphModeEl.value : 'counts';
}

function getGraphDataForMode(mode) {
    const lastPoint = graphSeries.length ? graphSeries[graphSeries.length - 1] : null;

    if (!graphSeries.length) {
        return {
            lines: [],
            yMax: 1,
            yLabel: 'Value',
            valueFormat: (value) => String(value),
            showPercentScale: false
        };
    }

    if (mode === 'hits') {
        return {
            lines: [{ key: 'hitCount', style: GRAPH_STYLES.hit }],
            yMax: Math.max(1, ...graphSeries.map((point) => point.hitCount)),
            yLabel: 'Hit count',
            valueFormat: (value) => String(Math.round(value)),
            showPercentScale: false
        };
    }

    if (mode === 'misses') {
        return {
            lines: [{ key: 'missCount', style: GRAPH_STYLES.miss }],
            yMax: Math.max(1, ...graphSeries.map((point) => point.missCount)),
            yLabel: 'Miss count',
            valueFormat: (value) => String(Math.round(value)),
            showPercentScale: false
        };
    }

    if (mode === 'percentages') {
        return {
            lines: [
                { key: 'hitPercent', style: GRAPH_STYLES.hit },
                { key: 'missPercent', style: GRAPH_STYLES.miss }
            ],
            yMax: 100,
            yLabel: 'Percentage',
            valueFormat: (value) => `${Math.round(value)}%`,
            showPercentScale: true
        };
    }

    return {
        lines: [
            { key: 'hitCount', style: GRAPH_STYLES.hit },
            { key: 'missCount', style: GRAPH_STYLES.miss }
        ],
        yMax: Math.max(1, lastPoint ? Math.max(lastPoint.hitCount, lastPoint.missCount) : 1),
        yLabel: 'Count',
        valueFormat: (value) => String(Math.round(value)),
        showPercentScale: false
    };
}

function getVisibleDomainPoints() {
    return getVisiblePoints();
}

function zoomAt(factor, centerRatio = 0.5) {
    if (!graphSeries.length) {
        return;
    }

    const total = graphSeries.length;
    const currentSize = Math.max(1, viewSize || total);
    const nextSize = Math.max(
        MIN_VIEW_POINTS,
        Math.min(total, Math.round(currentSize * factor))
    );
    const clampedRatio = Math.max(0, Math.min(1, centerRatio));
    const focusIndex = viewStart + Math.round(currentSize * clampedRatio);
    const nextStart = focusIndex - Math.round(nextSize * clampedRatio);

    viewSize = nextSize;
    viewStart = nextStart;
    clampView();
    syncPanControl();
    renderGraph();
}

function panBy(deltaPoints) {
    if (!graphSeries.length) {
        return;
    }

    viewStart += deltaPoints;
    clampView();
    syncPanControl();
    renderGraph();
}

function drawGraph() {
    if (!graphCanvasEl) {
        return;
    }

    const ctx = graphCanvasEl.getContext('2d');
    if (!ctx) {
        return;
    }

    const width = graphCanvasEl.clientWidth || 900;
    const height = graphCanvasEl.clientHeight || 500;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));

    if (graphCanvasEl.width !== pixelWidth || graphCanvasEl.height !== pixelHeight) {
        graphCanvasEl.width = pixelWidth;
        graphCanvasEl.height = pixelHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#0b1016';
    ctx.fillRect(0, 0, width, height);

    const graphData = getGraphDataForMode(getGraphMode());
    const points = getVisibleDomainPoints();
    const padding = {
        top: 24,
        right: 20,
        bottom: 40,
        left: graphData.showPercentScale ? 46 : 38
    };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);
    const originX = padding.left;
    const originY = height - padding.bottom;
    const xStep = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.lineWidth = 1;

    const tickCount = points.length > 0 ? Math.min(6, points.length) : 1;
    for (let tick = 0; tick <= tickCount; tick += 1) {
        const ratio = tickCount === 0 ? 0 : tick / tickCount;
        const x = originX + plotWidth * ratio;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(48, 54, 61, 0.35)';
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, originY);
        ctx.stroke();

        if (points.length) {
            const labelIndex = Math.min(points.length - 1, Math.round((points.length - 1) * ratio));
            const label = String(points[labelIndex].instructionNo);
            const textWidth = ctx.measureText(label).width;
            ctx.fillStyle = '#8b949e';
            ctx.fillText(label, x - textWidth / 2, originY + 16);
        }
    }

    const yTickCount = graphData.showPercentScale ? 5 : 4;
    for (let tick = 0; tick <= yTickCount; tick += 1) {
        const ratio = yTickCount === 0 ? 0 : tick / yTickCount;
        const y = originY - plotHeight * ratio;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(48, 54, 61, 0.35)';
        ctx.moveTo(originX, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        const value = graphData.yMax * ratio;
        ctx.fillStyle = '#6e7681';
        ctx.fillText(graphData.valueFormat(value), 8, y + 3);
    }

    if (!points.length) {
        ctx.fillStyle = '#6e7681';
        ctx.textAlign = 'center';
        ctx.fillText('Run the simulation on the main page first.', width / 2, height / 2);
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
        series.forEach((point) => {
            ctx.lineTo(point.x, point.y);
        });
        ctx.lineTo(series[series.length - 1].x, originY);
        ctx.closePath();
        ctx.fillStyle = line.style.fill;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = line.style.color;
        ctx.lineWidth = 2;
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

    ctx.fillStyle = '#8b949e';
    ctx.fillText('Instructions', width / 2 - 36, height - 10);
    ctx.save();
    ctx.translate(12, height / 2 + 22);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(graphData.yLabel, 0, 0);
    ctx.restore();
}

function renderGraph() {
    updateStats();
    drawGraph();
}

loadGraphData();
renderGraph();

if (graphModeEl) {
    graphModeEl.addEventListener('change', renderGraph);
}

if (zoomInBtnEl) {
    zoomInBtnEl.addEventListener('click', () => zoomAt(ZOOM_STEP));
}

if (zoomOutBtnEl) {
    zoomOutBtnEl.addEventListener('click', () => zoomAt(1 / ZOOM_STEP));
}

if (resetViewBtnEl) {
    resetViewBtnEl.addEventListener('click', () => {
        resetView();
        renderGraph();
    });
}

if (graphPanEl) {
    graphPanEl.addEventListener('input', () => {
        viewStart = Number.parseInt(graphPanEl.value, 10) || 0;
        clampView();
        renderGraph();
    });
}

if (graphCanvasEl) {
    graphCanvasEl.addEventListener('wheel', (event) => {
        if (!graphSeries.length) {
            return;
        }

        event.preventDefault();
        const rect = graphCanvasEl.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const centerRatio = Math.max(0, Math.min(1, x / Math.max(1, rect.width)));
        if (event.deltaY < 0) {
            zoomAt(ZOOM_STEP, centerRatio);
        } else {
            zoomAt(1 / ZOOM_STEP, centerRatio);
        }
    }, { passive: false });

    graphCanvasEl.addEventListener('mousedown', (event) => {
        if (!graphSeries.length) {
            return;
        }

        isDragging = true;
        dragStartX = event.clientX;
        dragStartViewStart = viewStart;
        graphCanvasEl.classList.add('is-dragging');
        event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
        if (!isDragging || !graphSeries.length) {
            return;
        }

        const rect = graphCanvasEl.getBoundingClientRect();
        const plotWidth = Math.max(1, rect.width - 58);
        const visiblePoints = Math.max(1, viewSize || graphSeries.length);
        const pointsPerPixel = visiblePoints / plotWidth;
        const deltaPoints = Math.round((dragStartX - event.clientX) * pointsPerPixel);
        viewStart = dragStartViewStart + deltaPoints;
        clampView();
        syncPanControl();
        renderGraph();
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) {
            return;
        }

        isDragging = false;
        graphCanvasEl.classList.remove('is-dragging');
    });
}

window.addEventListener('resize', renderGraph);
