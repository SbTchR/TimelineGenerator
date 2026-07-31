const pxPerMm = 96 / 25.4;
const A4 = {
    portrait: { w: 210, h: 297 },
    landscape: { w: 297, h: 210 }
};

const state = {
    title: 'Ma frise chronologique',
    start: 1900,
    end: 2025,
    mainStep: 10,
    secondaryPerMain: 4,
    mmPerMain: 15,
    mainTickHeight: 20,
    secondaryTickHeight: 12,
    backgroundColor: 'transparent',
    baselineColor: '#0f172a',
    mainTickColor: '#0f172a',
    secondaryTickColor: '#94a3b8',
    labelColor: '#0f172a',
    labelSize: 12,
    labelOffset: 6,
    labelFont: 'DM Sans',
    dateFormat: 'numeric',
    showSecondaryLabels: false,
    secondaryLabelSize: 10,
    secondaryLabelColor: '#6b7a90',
    secondaryLabelOffset: 4,
    secondaryLabelFont: 'DM Sans',
    timelineHeight: 950,
    padding: 60,
    eventBaseOffset: 20,
    periodBaseOffset: -290,
    events: [],
    periods: [],
    exportScale: 4,
    orientation: 'landscape'
};

const defaultState = JSON.parse(JSON.stringify(state));
let editingEventId = null;
let editingPeriodId = null;
let aiPromptMode = 'chatbot';
let timelineZoom = 1;
let historySnapshot = null;
let historyApplying = false;
let historyCoalesceOpen = false;
let historyCoalesceTimer = null;
const undoStack = [];
const redoStack = [];
const HISTORY_LIMIT = 80;
const ZOOM_STORAGE_KEY = 'timeline-generator:zoom:v1';

const elTimeline = document.getElementById('timeline-space');
const elEventList = document.getElementById('event-list');
const elPeriodList = document.getElementById('period-list');
const elSettingsModal = document.getElementById('settings-modal');
const elTimelineScroll = document.getElementById('timeline-scroll');
const toggleListsBtn = document.getElementById('toggle-lists');
const eventSubmitBtn = document.getElementById('event-submit');
const periodSubmitBtn = document.getElementById('period-submit');
const elAiModal = document.getElementById('ai-modal');
const elEmptyState = document.getElementById('empty-state');
const elCanvasTitle = document.getElementById('canvas-title');
const elTimelineMeta = document.getElementById('timeline-meta');
const elAutosaveStatus = document.getElementById('autosave-status');
const elToastRegion = document.getElementById('toast-region');
const elAiPrompt = document.getElementById('ai-prompt');
const elAiTopic = document.getElementById('ai-topic');
const elAiEventCount = document.getElementById('ai-event-count');
const elAiPeriodCount = document.getElementById('ai-period-count');
const elAiImageMode = document.getElementById('ai-image-mode');
const elAiPromptHeading = document.getElementById('ai-prompt-heading');
const elAiPromptDescription = document.getElementById('ai-prompt-description');
const elAiJsonInput = document.getElementById('ai-json-input');
const elAiImportStatus = document.getElementById('ai-import-status');
const elUndoAction = document.getElementById('undo-action');
const elRedoAction = document.getElementById('redo-action');
const elZoomValue = document.getElementById('zoom-reset');
const DRAFT_STORAGE_KEY = 'timeline-generator:draft:v2';
let listsVisible = true;

elTimelineScroll.style.height = '100%';

function toggleModal(show) {
    elSettingsModal.classList.toggle('hidden', !show);
    elSettingsModal.setAttribute('aria-hidden', String(!show));
    document.body.classList.toggle('modal-open', show || !elAiModal.classList.contains('hidden'));
    if (show) document.getElementById('close-settings-btn')?.focus();
}

function toggleAiModal(show) {
    elAiModal.classList.toggle('hidden', !show);
    elAiModal.setAttribute('aria-hidden', String(!show));
    document.body.classList.toggle('modal-open', show || !elSettingsModal.classList.contains('hidden'));
    if (show) {
        updateAiPrompt();
        window.setTimeout(() => elAiTopic?.focus(), 0);
    }
}

function createId(prefix = 'item') {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function showToast(message, type = 'success') {
    if (!elToastRegion) return;
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
    toast.textContent = message;
    elToastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3200);
}

function syncSettingsControls() {
    document.querySelectorAll('[data-setting]').forEach(input => {
        const key = input.dataset.setting;
        if (state[key] === undefined) return;
        if (input.type === 'checkbox') input.checked = Boolean(state[key]);
        else if (key === 'backgroundColor' && state[key] === 'transparent') input.value = '#ffffff';
        else input.value = state[key];
    });

    const transparent = state.backgroundColor === 'transparent';
    const transparentToggle = document.getElementById('bg-transparent');
    const backgroundInput = document.querySelector('[data-setting="backgroundColor"]');
    if (transparentToggle) transparentToggle.checked = transparent;
    if (backgroundInput) backgroundInput.disabled = transparent;
    document.getElementById('pdf-orientation').value = state.orientation;
}

function persistDraft() {
    try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(state));
        if (elAutosaveStatus) {
            elAutosaveStatus.lastChild.textContent = ' Enregistré localement';
        }
    } catch (error) {
        if (elAutosaveStatus) {
            elAutosaveStatus.lastChild.textContent = ' Sauvegarde locale indisponible';
        }
    }
}

function updateHistoryControls() {
    if (elUndoAction) elUndoAction.disabled = undoStack.length === 0;
    if (elRedoAction) elRedoAction.disabled = redoStack.length === 0;
}

function trackHistory({ coalesce = false } = {}) {
    const current = JSON.stringify(state);
    if (historySnapshot === null) {
        historySnapshot = current;
        updateHistoryControls();
        return;
    }
    if (current === historySnapshot) return;

    if (!historyApplying) {
        if (!coalesce || !historyCoalesceOpen) {
            undoStack.push(historySnapshot);
            if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        }
        redoStack.length = 0;
    }

    historySnapshot = current;
    historyCoalesceOpen = coalesce;
    window.clearTimeout(historyCoalesceTimer);
    if (coalesce) {
        historyCoalesceTimer = window.setTimeout(() => {
            historyCoalesceOpen = false;
        }, 500);
    }
    updateHistoryControls();
}

function applyHistorySnapshot(snapshot, message) {
    if (!snapshot) return;
    historyApplying = true;
    Object.assign(state, JSON.parse(snapshot));
    editingEventId = null;
    editingPeriodId = null;
    eventForm?.reset();
    periodForm?.reset();
    if (eventSubmitBtn) eventSubmitBtn.textContent = 'Ajouter l’événement';
    if (periodSubmitBtn) periodSubmitBtn.textContent = 'Ajouter la période';
    syncSettingsControls();
    renderTimeline();
    historyApplying = false;
    historySnapshot = JSON.stringify(state);
    historyCoalesceOpen = false;
    updateHistoryControls();
    showToast(message);
}

function undoTimeline() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state));
    applyHistorySnapshot(undoStack.pop(), 'Modification annulée.');
}

function redoTimeline() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state));
    applyHistorySnapshot(redoStack.pop(), 'Modification rétablie.');
}

function updateZoomControls() {
    const percentage = Math.round(timelineZoom * 100);
    if (elZoomValue) elZoomValue.textContent = `${percentage}%`;
    const zoomOut = document.getElementById('zoom-out');
    const zoomIn = document.getElementById('zoom-in');
    if (zoomOut) zoomOut.disabled = timelineZoom <= 0.5;
    if (zoomIn) zoomIn.disabled = timelineZoom >= 2;
}

function setTimelineZoom(value, { preserveCenter = true, announce = false } = {}) {
    const next = Math.min(2, Math.max(0.5, Math.round(value * 10) / 10));
    const previous = timelineZoom || 1;
    const centerX = preserveCenter
        ? (elTimelineScroll.scrollLeft + elTimelineScroll.clientWidth / 2) / previous
        : 0;
    const centerY = preserveCenter
        ? (elTimelineScroll.scrollTop + elTimelineScroll.clientHeight / 2) / previous
        : 0;

    timelineZoom = next;
    elTimeline.style.zoom = String(timelineZoom);
    elTimeline.dataset.zoom = String(timelineZoom);
    updateZoomControls();
    try {
        localStorage.setItem(ZOOM_STORAGE_KEY, String(timelineZoom));
    } catch (error) {
        // Le zoom reste utilisable même si le stockage local est indisponible.
    }

    if (preserveCenter) {
        window.requestAnimationFrame(() => {
            elTimelineScroll.scrollLeft = Math.max(0, centerX * next - elTimelineScroll.clientWidth / 2);
            elTimelineScroll.scrollTop = Math.max(0, centerY * next - elTimelineScroll.clientHeight / 2);
        });
    }
    if (announce) showToast(`Zoom réglé à ${Math.round(timelineZoom * 100)} %.`);
    return timelineZoom;
}

function setDateFormat(format, { announce = false } = {}) {
    state.dateFormat = format === 'long' ? 'long' : 'numeric';
    syncSettingsControls();
    renderTimeline();
    if (announce) {
        showToast(state.dateFormat === 'long'
            ? 'Dates affichées en toutes lettres.'
            : 'Dates affichées au format numérique.');
    }
    return state.dateFormat;
}

function restoreTimelineZoom() {
    try {
        timelineZoom = Math.min(2, Math.max(0.5, toNumber(localStorage.getItem(ZOOM_STORAGE_KEY), 1)));
    } catch (error) {
        timelineZoom = 1;
    }
    setTimelineZoom(timelineZoom, { preserveCenter: false });
}

function setMobileView(view) {
    if (!['editor', 'canvas', 'items'].includes(view)) return;
    document.body.dataset.mobileView = view;
    document.querySelectorAll('.mobile-view-tabs [data-mobile-view]').forEach(button => {
        const active = button.dataset.mobileView === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'page' : 'false');
    });
}

function setEditorTab(type) {
    const isEvent = type === 'event';
    document.getElementById('event-editor').classList.toggle('hidden', !isEvent);
    document.getElementById('period-editor').classList.toggle('hidden', isEvent);
    document.querySelectorAll('[data-editor-tab]').forEach(button => {
        const active = button.dataset.editorTab === type;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
    });
}

function closeMobileActions() {
    document.getElementById('mobile-actions-popover')?.classList.add('hidden');
    document.getElementById('mobile-more')?.setAttribute('aria-expanded', 'false');
}

toggleListsBtn?.addEventListener('click', () => {
    listsVisible = !listsVisible;
    document.body.classList.toggle('hide-lists', !listsVisible);
    toggleListsBtn.textContent = listsVisible ? 'Tout masquer' : 'Tout afficher';
});

document.getElementById('open-settings').addEventListener('click', () => toggleModal(true));
document.getElementById('close-settings').addEventListener('click', () => toggleModal(false));
document.getElementById('close-settings-btn').addEventListener('click', () => toggleModal(false));
document.getElementById('open-ai').addEventListener('click', () => toggleAiModal(true));
document.getElementById('close-ai').addEventListener('click', () => toggleAiModal(false));
document.getElementById('close-ai-btn').addEventListener('click', () => toggleAiModal(false));
elUndoAction?.addEventListener('click', undoTimeline);
elRedoAction?.addEventListener('click', redoTimeline);
document.getElementById('zoom-out')?.addEventListener('click', () => {
    setTimelineZoom(timelineZoom - 0.1, { announce: true });
});
document.getElementById('zoom-in')?.addEventListener('click', () => {
    setTimelineZoom(timelineZoom + 0.1, { announce: true });
});
elZoomValue?.addEventListener('click', () => {
    setTimelineZoom(1, { announce: true });
});
document.getElementById('apply-settings').addEventListener('click', () => {
    toggleModal(false);
    renderTimeline();
});

document.querySelectorAll('[data-editor-tab]').forEach(button => {
    button.addEventListener('click', () => setEditorTab(button.dataset.editorTab));
});

document.querySelectorAll('.mobile-view-tabs [data-mobile-view]').forEach(button => {
    button.addEventListener('click', () => setMobileView(button.dataset.mobileView));
});

document.getElementById('mobile-add').addEventListener('click', () => {
    setMobileView('editor');
    setEditorTab('event');
    window.setTimeout(() => document.querySelector('#event-form input[name="title"]')?.focus(), 0);
});

document.querySelector('[data-empty-action="create"]').addEventListener('click', () => {
    setMobileView('editor');
    setEditorTab('event');
    window.setTimeout(() => document.querySelector('#event-form input[name="title"]')?.focus(), 0);
});

document.querySelector('[data-empty-action="ai"]').addEventListener('click', () => toggleAiModal(true));

document.getElementById('mobile-more').addEventListener('click', () => {
    const popover = document.getElementById('mobile-actions-popover');
    const willOpen = popover.classList.contains('hidden');
    popover.classList.toggle('hidden', !willOpen);
    document.getElementById('mobile-more').setAttribute('aria-expanded', String(willOpen));
});

document.querySelectorAll('[data-proxy-action]').forEach(button => {
    button.addEventListener('click', () => {
        closeMobileActions();
        document.getElementById(button.dataset.proxyAction)?.click();
    });
});

document.addEventListener('keydown', event => {
    const modifier = event.metaKey || event.ctrlKey;
    const editableTarget = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (modifier && !editableTarget && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoTimeline();
        else undoTimeline();
        return;
    }
    if (modifier && !editableTarget && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoTimeline();
        return;
    }
    if (event.key === 'Escape') {
        toggleModal(false);
        toggleAiModal(false);
        closeMobileActions();
    }
});

document.addEventListener('pointerdown', event => {
    const popover = document.getElementById('mobile-actions-popover');
    if (popover?.classList.contains('hidden')) return;
    if (!popover.contains(event.target) && !document.getElementById('mobile-more').contains(event.target)) {
        closeMobileActions();
    }
});

elCanvasTitle.addEventListener('input', () => {
    state.title = elCanvasTitle.textContent.trim() || 'Ma frise chronologique';
    trackHistory({ coalesce: true });
    persistDraft();
});

elCanvasTitle.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        elCanvasTitle.blur();
    }
});

document.querySelectorAll('[data-setting]').forEach(input => {
    input.addEventListener('input', (e) => {
        const key = e.target.dataset.setting;
        let val = e.target.value;
        if (e.target.type === 'number') val = parseFloat(val);
        if (e.target.type === 'checkbox') val = e.target.checked;

        if (key === 'backgroundColor') {
            if (!document.getElementById('bg-transparent').checked) {
                state[key] = val;
            }
        } else {
            state[key] = val;
        }

        if (key === 'timelineHeight') {
            elTimelineScroll.style.height = '100%';
        }
        renderTimeline({ coalesceHistory: true });
    });
});

document.getElementById('bg-transparent').addEventListener('change', (e) => {
    const colorInput = document.querySelector('[data-setting="backgroundColor"]');
    if (e.target.checked) {
        state.backgroundColor = 'transparent';
        colorInput.disabled = true;
    } else {
        state.backgroundColor = colorInput.value;
        colorInput.disabled = false;
    }
    renderTimeline();
});

document.getElementById('pdf-orientation').addEventListener('change', (e) => {
    state.orientation = e.target.value;
    renderTimeline();
});

document.getElementById('reset-settings').addEventListener('click', () => {
    Object.keys(defaultState).forEach(key => {
        if (key === 'events' || key === 'periods' || key === 'title') return;
        state[key] = defaultState[key];
        const input = document.querySelector(`[data-setting="${key}"]`);
        if (input) {
            if (key === 'backgroundColor') {
                const isTransp = defaultState[key] === 'transparent';
                document.getElementById('bg-transparent').checked = isTransp;
                input.value = isTransp ? '#ffffff' : defaultState[key]; // Set a default visible color if transparent
                input.disabled = isTransp;
            } else if (input.type === 'checkbox') {
                input.checked = defaultState[key];
            } else {
                input.value = defaultState[key];
            }
        }
    });
    elTimelineScroll.style.height = '100%';
    renderTimeline();
});

document.getElementById('clear-events').addEventListener('click', () => {
    state.events = [];
    editingEventId = null;
    eventSubmitBtn.textContent = "Ajouter l'événement";
    renderTimeline();
});
document.getElementById('clear-periods').addEventListener('click', () => {
    state.periods = [];
    editingPeriodId = null;
    periodSubmitBtn.textContent = "Ajouter la période";
    renderTimeline();
});

function loadImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

function toNumber(value, fallback) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
    return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 0;
}

function formatCalendarYear(year) {
    return year < 0 ? `${Math.abs(year)} av. J.-C.` : String(year).padStart(4, '0');
}

const FRENCH_MONTHS = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
];

function formatCalendarParts(parts, format = state.dateFormat) {
    if (!parts) return '';
    const day = format === 'long' ? String(parts.day) : String(parts.day).padStart(2, '0');
    const month = format === 'long'
        ? FRENCH_MONTHS[parts.month - 1]
        : String(parts.month).padStart(2, '0');
    const separator = format === 'long' ? ' ' : '.';
    return `${day}${separator}${month}${separator}${formatCalendarYear(parts.year)}`;
}

function parseCalendarDate(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    let year;
    let month;
    let day;
    let match = raw.match(/^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
    } else {
        match = raw.match(/^(\d{1,2})[./](\d{1,2})[./](-?\d{1,6})$/);
        if (!match) return null;
        day = Number(match[1]);
        month = Number(match[2]);
        year = Number(match[3]);
    }

    if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
        return null;
    }

    const daysBefore = Array.from({ length: month - 1 }, (_, index) => daysInMonth(year, index + 1))
        .reduce((sum, days) => sum + days, 0);
    const daysInYear = isLeapYear(year) ? 366 : 365;
    const decimalValue = year + (daysBefore + day - 1) / daysInYear;
    const yearIso = `${year < 0 ? '-' : ''}${String(Math.abs(year)).padStart(4, '0')}`;
    return {
        year,
        month,
        day,
        value: decimalValue,
        iso: `${yearIso}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        label: formatCalendarParts({ year, month, day }, 'numeric')
    };
}

function decimalYearToCalendar(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Number.isInteger(numeric)) return null;
    const year = Math.floor(numeric);
    if (Math.abs(year) < 100 || Math.abs(year) > 9999) return null;
    const daysInYear = isLeapYear(year) ? 366 : 365;
    let dayIndex = Math.min(daysInYear - 1, Math.max(0, Math.floor((numeric - year) * daysInYear)));
    let month = 1;
    while (month <= 12 && dayIndex >= daysInMonth(year, month)) {
        dayIndex -= daysInMonth(year, month);
        month += 1;
    }
    const day = dayIndex + 1;
    return {
        year,
        month,
        day,
        label: formatCalendarParts({ year, month, day }, 'numeric')
    };
}

function parseTimelineCoordinate(rawValue, fallback, explicitDate = null) {
    const parsedDate = parseCalendarDate(explicitDate) || parseCalendarDate(rawValue);
    if (parsedDate) return { value: parsedDate.value, date: parsedDate.iso };
    const numeric = Number(String(rawValue ?? '').trim().replace(',', '.'));
    return {
        value: Number.isFinite(numeric) ? numeric : fallback,
        date: null
    };
}

function formatTimelineValue(value, exactDate = null) {
    const parsedDate = parseCalendarDate(exactDate);
    if (parsedDate) return formatCalendarParts(parsedDate);
    const inferredDate = decimalYearToCalendar(value);
    if (inferredDate) return formatCalendarParts(inferredDate);
    return String(Number.isFinite(Number(value)) ? Number(value) : value);
}

function formatEditableTimelineValue(value, exactDate = null) {
    const parsedDate = parseCalendarDate(exactDate);
    if (parsedDate) return formatCalendarParts(parsedDate, 'numeric');
    const inferredDate = decimalYearToCalendar(value);
    if (inferredDate) return formatCalendarParts(inferredDate, 'numeric');
    return String(Number.isFinite(Number(value)) ? Number(value) : value);
}

function eventSuggestedWidth(input = {}) {
    const titleLength = String(input.title || '').trim().length;
    const detailLength = String(input.detail || '').trim().length;
    const fontSize = Math.max(8, toNumber(input.fontSize, 14));
    const contentScore = Math.sqrt(titleLength * 1.4 + detailLength * 0.72) * fontSize * 0.62;
    const imageRequirement = input.image ? toNumber(input.imageWidth, 120) + 24 : 0;
    return Math.round(Math.min(320, Math.max(145, 105 + contentScore, imageRequirement)));
}

function stripCodeFences(value) {
    return String(value || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
}

function safeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}

function optionalString(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
}

function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Math.round(toNumber(value, fallback));
    return Math.min(maximum, Math.max(minimum, parsed));
}

function suggestMainStep(start, end) {
    const span = Math.max(end - start, 1);
    const rough = span / 10;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const normalized = rough / magnitude;
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return Math.max(Number((nice * magnitude).toPrecision(8)), 0.01);
}

const EVENT_PALETTE = [
    { background: '#ffe7e2', accent: '#ff806f' },
    { background: '#fff0cf', accent: '#e6a93f' },
    { background: '#e7efff', accent: '#6e91e8' },
    { background: '#f0e7ff', accent: '#9b78dd' }
];

const PERIOD_PALETTE = [
    { background: '#dff8f5', accent: '#43c4b8' },
    { background: '#e6efff', accent: '#6e91e8' },
    { background: '#f0e7ff', accent: '#9b78dd' }
];

function normalizeEventInput(input = {}, index = 0) {
    const palette = EVENT_PALETTE[index % EVENT_PALETTE.length];
    const position = parseTimelineCoordinate(input.value, state.start, input.date);
    const hasExplicitWidth = Number.isFinite(Number(input.width));
    const autoWidth = input.autoWidth === true || !hasExplicitWidth;
    const hasExplicitHeight = input.height !== null
        && input.height !== undefined
        && input.height !== ''
        && Number.isFinite(Number(input.height));
    const explicitHeight = hasExplicitHeight ? Number(input.height) : null;
    return {
        id: input.id || createId('event'),
        title: String(input.title || `Événement ${index + 1}`).trim(),
        value: position.value,
        date: position.date,
        font: input.font || 'DM Sans',
        fontSize: Math.max(8, toNumber(input.fontSize, 14)),
        width: autoWidth
            ? eventSuggestedWidth(input)
            : Math.min(480, Math.max(120, toNumber(input.width, 145))),
        height: hasExplicitHeight
            ? Math.min(720, Math.max(72, explicitHeight))
            : null,
        autoWidth,
        textColor: safeColor(input.textColor, '#111c44'),
        backgroundColor: safeColor(input.backgroundColor, palette.background),
        backgroundOpacity: Math.min(1, Math.max(0.05, toNumber(input.backgroundOpacity, 0.96))),
        connectorColor: safeColor(input.connectorColor, palette.accent),
        showDate: input.showDate !== false,
        showTitle: input.showTitle !== false,
        showDetail: input.showDetail !== false,
        detail: String(input.detail || '').trim(),
        image: typeof input.image === 'string' ? input.image : null,
        imageAlt: optionalString(input.imageAlt),
        imageSourceUrl: optionalString(input.imageSourceUrl),
        imageCredit: optionalString(input.imageCredit),
        imageWidth: Math.max(10, toNumber(input.imageWidth, 120)),
        imageHeight: Math.max(10, toNumber(input.imageHeight, 90)),
        offsetX: toNumber(input.offsetX, 0),
        offsetY: toNumber(input.offsetY, [0, 160, 320][index % 3]),
        visible: input.visible !== false
    };
}

function normalizePeriodInput(input = {}, index = 0) {
    const palette = PERIOD_PALETTE[index % PERIOD_PALETTE.length];
    const startPosition = parseTimelineCoordinate(input.start, state.start, input.startDate);
    const endPosition = parseTimelineCoordinate(input.end, state.end, input.endDate);
    const isReversed = startPosition.value > endPosition.value;
    return {
        id: input.id || createId('period'),
        title: String(input.title || `Période ${index + 1}`).trim(),
        start: isReversed ? endPosition.value : startPosition.value,
        end: isReversed ? startPosition.value : endPosition.value,
        startDate: isReversed ? endPosition.date : startPosition.date,
        endDate: isReversed ? startPosition.date : endPosition.date,
        style: input.style === 'line' ? 'line' : 'rect',
        thickness: Math.max(1, toNumber(input.thickness, 2)),
        rectHeight: Math.max(12, toNumber(input.rectHeight, 52)),
        titleAlignment: ['top', 'middle', 'bottom'].includes(input.titleAlignment)
            ? input.titleAlignment
            : 'middle',
        fillColor: safeColor(input.fillColor, palette.background),
        fillOpacity: Math.min(1, Math.max(0.05, toNumber(input.fillOpacity, 0.75))),
        textColor: safeColor(input.textColor, '#111c44'),
        strokeColor: safeColor(input.strokeColor, palette.accent),
        font: input.font || 'DM Sans',
        fontSize: Math.max(8, toNumber(input.fontSize, 13)),
        showDate: input.showDate !== false,
        showTitle: input.showTitle !== false,
        showDetail: input.showDetail !== false,
        detail: String(input.detail || '').trim(),
        image: typeof input.image === 'string' ? input.image : null,
        imageAlt: optionalString(input.imageAlt),
        imageSourceUrl: optionalString(input.imageSourceUrl),
        imageCredit: optionalString(input.imageCredit),
        imageWidth: Math.max(10, toNumber(input.imageWidth, 120)),
        imageHeight: Math.max(10, toNumber(input.imageHeight, 80)),
        offsetX: 0,
        offsetY: toNumber(input.offsetY, (index % 3) * 64),
        visible: input.visible !== false
    };
}

function projectedValueToX(value, config) {
    const pixelsPerMain = config.mmPerMain * pxPerMm;
    return config.padding + ((value - config.start) / config.mainStep) * pixelsPerMain;
}

function estimateEventHeight(event) {
    const contentWidth = Math.max(46, (event.width || 145) - 24);
    const estimateLines = (text, fontSize) => {
        const charactersPerLine = Math.max(8, contentWidth / (fontSize * 0.56));
        return Math.max(1, Math.ceil(String(text || '').length / charactersPerLine));
    };
    let height = 28;
    if (event.showTitle !== false) {
        height += estimateLines(event.title, event.fontSize * 1.15) * event.fontSize * 1.38 + 5;
    }
    if (event.showDate !== false) height += 20;
    if (event.detail && event.showDetail !== false) {
        height += estimateLines(event.detail, event.fontSize * 0.9) * event.fontSize * 1.22 + 6;
    }
    if (event.image) height += event.imageHeight + 14;
    return Math.ceil(height);
}

function planEventLanes(events, config) {
    const laneRightEdges = [];
    const assignments = new Map();
    const sorted = events
        .map((event, index) => ({ event, index }))
        .sort((a, b) => a.event.value - b.event.value || a.index - b.index);

    sorted.forEach(({ event, index }) => {
        const center = projectedValueToX(event.value, config) + (event.offsetX || 0);
        const halfWidth = (event.width || 145) / 2;
        const left = center - halfWidth;
        let lane = laneRightEdges.findIndex(right => left >= right + 24);
        if (lane === -1) lane = laneRightEdges.length;
        laneRightEdges[lane] = center + halfWidth;
        assignments.set(index, lane);
    });

    return {
        assignments,
        laneCount: laneRightEdges.length
    };
}

function arrangeImportedEvents(normalized, sourceEvents, hasCustomScale) {
    const automaticIndexes = normalized.events
        .map((event, index) => ({ event, index }))
        .filter(({ index }) => !Number.isFinite(parseFloat(sourceEvents[index]?.offsetY)));

    if (!automaticIndexes.length) return;

    let plan = planEventLanes(automaticIndexes.map(item => item.event), normalized);
    if (!hasCustomScale) {
        while (plan.laneCount > 3 && normalized.mmPerMain < 60) {
            normalized.mmPerMain = Math.min(60, normalized.mmPerMain * 1.22);
            plan = planEventLanes(automaticIndexes.map(item => item.event), normalized);
        }
    }

    const laneHeights = Array(plan.laneCount).fill(0);
    automaticIndexes.forEach(({ event }, automaticIndex) => {
        const lane = plan.assignments.get(automaticIndex);
        laneHeights[lane] = Math.max(laneHeights[lane], estimateEventHeight(event));
    });

    const laneOffsets = [];
    let nextOffset = 0;
    laneHeights.forEach((height, lane) => {
        laneOffsets[lane] = nextOffset;
        nextOffset += height + 24;
    });

    automaticIndexes.forEach(({ event }, automaticIndex) => {
        event.offsetY = laneOffsets[plan.assignments.get(automaticIndex)];
    });

    const requiredHalfHeight = normalized.eventBaseOffset + nextOffset + 34;
    normalized.timelineHeight = Math.max(
        normalized.timelineHeight,
        Math.ceil((requiredHalfHeight * 2) / 10) * 10
    );
}

function normalizeTimelinePayload(payload, { adaptiveEventWidth = false } = {}) {
    const parsed = typeof payload === 'string' ? JSON.parse(stripCodeFences(payload)) : payload;
    const source = parsed?.timeline && typeof parsed.timeline === 'object' ? parsed.timeline : parsed;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('Le résultat doit être un objet JSON.');
    }

    const startValue = toNumber(source.start, defaultState.start);
    const endValue = toNumber(source.end, defaultState.end);
    if (endValue <= startValue) {
        throw new Error('La valeur « end » doit être supérieure à « start ».');
    }

    if (!Array.isArray(source.events) || !Array.isArray(source.periods)) {
        throw new Error('Les propriétés « events » et « periods » doivent être des tableaux.');
    }

    const normalized = JSON.parse(JSON.stringify(defaultState));
    const safeConfigKeys = [
        'secondaryPerMain', 'mmPerMain', 'mainTickHeight', 'secondaryTickHeight',
        'backgroundColor', 'baselineColor', 'mainTickColor', 'secondaryTickColor',
        'labelColor', 'labelSize', 'labelOffset', 'labelFont', 'dateFormat', 'showSecondaryLabels',
        'secondaryLabelSize', 'secondaryLabelColor', 'secondaryLabelOffset',
        'secondaryLabelFont', 'timelineHeight', 'padding', 'eventBaseOffset',
        'periodBaseOffset', 'exportScale', 'orientation'
    ];
    safeConfigKeys.forEach(key => {
        if (source[key] !== undefined) normalized[key] = source[key];
    });

    normalized.title = String(source.title || 'Ma frise chronologique').trim();
    normalized.start = startValue;
    normalized.end = endValue;
    normalized.dateFormat = source.dateFormat === 'long'
        ? 'long'
        : source.dateFormat === 'numeric'
            ? 'numeric'
            : (state.dateFormat || defaultState.dateFormat);
    normalized.mainStep = Math.max(0.01, toNumber(source.mainStep, suggestMainStep(startValue, endValue)));
    normalized.events = source.events.map((event, index) => normalizeEventInput(
        adaptiveEventWidth ? { ...event, autoWidth: true } : event,
        index
    ));
    normalized.periods = source.periods.map((period, index) => normalizePeriodInput(period, index));
    if (source.timelineHeight === undefined) normalized.timelineHeight = 950;
    if (source.eventBaseOffset === undefined) normalized.eventBaseOffset = 20;
    if (source.periodBaseOffset === undefined) normalized.periodBaseOffset = -290;
    arrangeImportedEvents(normalized, source.events, source.mmPerMain !== undefined);
    normalized.orientation = source.orientation === 'portrait' ? 'portrait' : 'landscape';
    return normalized;
}

function applyTimelinePayload(payload, { announce = true, adaptiveEventWidth = false } = {}) {
    const normalized = normalizeTimelinePayload(payload, { adaptiveEventWidth });
    Object.assign(state, normalized);
    editingEventId = null;
    editingPeriodId = null;
    eventForm.reset();
    periodForm.reset();
    eventSubmitBtn.textContent = 'Ajouter l’événement';
    periodSubmitBtn.textContent = 'Ajouter la période';
    syncSettingsControls();
    renderTimeline();
    focusTimelineContent();
    if (announce) showToast('Frise importée avec succès.');
    return JSON.parse(JSON.stringify(state));
}

function focusTimelineContent() {
    window.requestAnimationFrame(() => {
        elTimelineScroll.scrollTop = Math.max(
            0,
            Number(state.timelineHeight) * timelineZoom / 2 - elTimelineScroll.clientHeight * 0.55
        );
    });
}

function readAiPromptOptions() {
    return {
        eventCount: clampInteger(elAiEventCount?.value, 1, 30, 10),
        periodCount: clampInteger(elAiPeriodCount?.value, 0, 10, 3),
        imageMode: ['none', 'highlights', 'all'].includes(elAiImageMode?.value)
            ? elAiImageMode.value
            : 'none',
        mode: aiPromptMode
    };
}

function buildAiPayloadExample(imageMode, periodCount) {
    const event = {
        title: 'Assassinat de l’archiduc François-Ferdinand',
        date: '1914-06-28',
        detail: 'L’attentat de Sarajevo précipite la crise diplomatique européenne.',
        backgroundColor: '#FFE7E2',
        textColor: '#111C44',
        connectorColor: '#FF806F'
    };
    const period = {
        title: 'Première Guerre mondiale',
        startDate: '1914-07-28',
        endDate: '1918-11-11',
        detail: 'Le conflit mobilise les puissances européennes puis mondiales.',
        fillColor: '#E6EFFF',
        strokeColor: '#6E91E8',
        textColor: '#111C44'
    };
    if (imageMode !== 'none') {
        Object.assign(event, {
            image: 'https://upload.wikimedia.org/chemin/vers/image.jpg',
            imageAlt: 'Description factuelle de l’image',
            imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Nom_du_fichier.jpg',
            imageCredit: 'Auteur ou institution — licence'
        });
    }
    if (imageMode === 'all') {
        Object.assign(period, {
            image: 'https://upload.wikimedia.org/chemin/vers/autre-image.jpg',
            imageAlt: 'Description factuelle de l’image',
            imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Autre_fichier.jpg',
            imageCredit: 'Auteur ou institution — licence'
        });
    }
    return JSON.stringify({
        title: 'Titre court de la frise',
        start: 1914,
        end: 1919,
        mainStep: 1,
        events: [event],
        periods: periodCount === 0 ? [] : [period]
    }, null, 2);
}

function buildAiPrompt(topic, options = {}) {
    const subject = String(topic || '').trim() || '[INDIQUEZ ICI LE THÈME]';
    const eventCount = clampInteger(options.eventCount, 1, 30, 10);
    const periodCount = clampInteger(options.periodCount, 0, 10, 3);
    const imageMode = ['none', 'highlights', 'all'].includes(options.imageMode)
        ? options.imageMode
        : 'none';
    const mode = options.mode === 'agent' ? 'agent' : 'chatbot';
    const example = buildAiPayloadExample(imageMode, periodCount);
    const imageInstruction = imageMode === 'none'
        ? '- Ne fournis aucune image et omets les quatre propriétés image, imageAlt, imageSourceUrl et imageCredit.'
        : imageMode === 'all'
            ? `- Illustre chacun des ${eventCount} événements${periodCount ? ` et chacune des ${periodCount} périodes` : ''}.`
            : `- Illustre seulement les éléments les plus structurants : au maximum ${Math.min(6, Math.max(2, Math.ceil(eventCount / 3)))} événements et ${Math.min(2, periodCount)} périodes.`;

    const commonRules = `CONTRAT DE DONNÉES
Le résultat doit suivre cette structure JSON :
${example}

RÈGLES DE CONTENU ET DE DATES
- Crée exactement ${eventCount} événements structurants, classés chronologiquement.
- Crée exactement ${periodCount} périodes cohérentes${periodCount === 0 ? ' ; periods doit donc être un tableau vide' : ''}.
- Pour une date connue au jour près, utilise obligatoirement date au format ISO AAAA-MM-JJ, par exemple "1914-06-28". L’application l’affichera selon le choix de l’utilisateur : 28.06.1914 ou 28 juin 1914.
- Pour une période connue au jour près, utilise startDate et endDate au format ISO AAAA-MM-JJ.
- Si seule l’année est historiquement connue, utilise value avec une année entière pour un événement, ou start et end avec des années entières pour une période. N’invente jamais un jour ou un mois.
- N’utilise jamais de fraction d’année comme 1914.49 pour représenter une date.
- start et end au niveau principal restent des années numériques avec une petite marge autour de la chronologie. Choisis un mainStep lisible.
- Les titres sont courts et les détails apportent une phrase factuelle utile. Signale sobrement toute incertitude.

RÈGLES DE MISE EN PAGE ET DE COULEURS
- N’ajoute ni width, ni offsetX, ni offsetY : l’application adapte la largeur des cartes au contenu et répartit automatiquement les événements sur des rangées sans chevauchement.
- Utilise au maximum quatre familles visuelles cohérentes. Pour une même catégorie, conserve le même couple fond/accent.
- Couples conseillés pour les événements : #FFE7E2/#FF806F, #FFF0CF/#E6A93F, #E7EFFF/#6E91E8, #F0E7FF/#9B78DD. connectorColor est aussi la couleur du pourtour de la carte.
- Pour les périodes : #DFF8F5/#43C4B8, #E6EFFF/#6E91E8 ou #F0E7FF/#9B78DD. Utilise #111C44 pour textColor.

RÈGLES POUR LES IMAGES
${imageInstruction}
- Cherche en priorité sur Wikimedia Commons, Europeana, Gallica, la NASA, l’ESA ou le site officiel d’une institution reconnue.
- image est une URL HTTPS directe et stable vers un fichier JPG, PNG ou WebP ; pour Wikimedia, préfère upload.wikimedia.org.
- imageSourceUrl pointe vers la page de provenance ; imageCredit contient l’auteur ou l’institution et la licence ; imageAlt décrit l’image.
- L’application conserve ces métadonnées sans afficher de légende sous l’image. Ne recopie donc jamais le crédit dans title ou detail.
- N’utilise pas de miniature de moteur de recherche, d’URL Google/Bing Images, de réseau social, d’URL temporaire ou de page HTML dans image.
- Si la provenance, la licence ou l’URL directe ne sont pas fiables, omets l’image.

CONTRÔLE QUALITÉ
- Vérifie le nombre exact d’éléments, l’ordre chronologique, la validité des dates et end > start.
- Vérifie que chaque événement et chaque période se trouve dans la plage principale.
- Vérifie la cohérence des couleurs, la fiabilité des images et la lisibilité du récit.`;

    if (mode === 'agent') {
        return `Tu es un agent navigateur autonome chargé de créer entièrement une frise dans l’application ouverte.

OBJECTIF
Construis et importe une frise fiable sur :
« ${subject} »
Ne demande pas à l’utilisateur de copier du JSON et ne t’arrête pas après avoir seulement proposé des données.

${commonRules}

PROCÉDURE AUTONOME OBLIGATOIRE
1. Inspecte d’abord le contrat avec window.timelineAgent.describe() si l’exécution JavaScript de la page est accessible. Le manifeste agent-manifest.json décrit également l’API et les sélecteurs stables.
2. Recherche et vérifie les informations historiques nécessaires, puis construis un unique objet JSON conforme au contrat ci-dessus.
3. Méthode préférée : appelle window.timelineAgent.importState(payload), puis window.timelineAgent.getState().
4. Si le navigateur isole les scripts et masque window.timelineAgent, utilise le chemin DOM : clique [data-agent-action="open-ai-assistant"], remplis #ai-json-input avec le JSON, puis clique [data-agent-action="import-ai-json"].
5. Vérifie que #timeline-space expose data-event-count="${eventCount}" et data-period-count="${periodCount}", ou vérifie les longueurs renvoyées par getState().
6. Contrôle le rendu : les dates précises doivent respecter le format choisi dans les paramètres, les textes des cartes doivent être entièrement visibles et deux rectangles .event ne doivent pas se recouvrir.
7. Si un contrôle échoue, corrige le payload et réimporte-le. Termine uniquement lorsque la frise est visible et conforme.
8. Dans ta réponse finale, indique brièvement que la frise a été créée, le nombre d’éléments et les éventuelles sources d’images utilisées.`;
    }

    return `Tu es un historien-documentaliste et un concepteur de frises chronologiques.

MISSION
Prépare une frise claire, fiable et synthétique sur :
« ${subject} »

${commonRules}

FORMAT DE RÉPONSE OBLIGATOIRE
Réponds UNIQUEMENT avec l’objet JSON final valide, sans Markdown, sans commentaire, sans bloc de code et sans texte avant ou après.
L’utilisateur collera ce JSON dans l’étape 3 de l’assistant puis cliquera sur « Créer la frise ».`;
}

function setAiPromptMode(mode) {
    aiPromptMode = mode === 'agent' ? 'agent' : 'chatbot';
    document.querySelectorAll('[data-ai-prompt-mode]').forEach(button => {
        const active = button.dataset.aiPromptMode === aiPromptMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
    });
    if (aiPromptMode === 'agent') {
        elAiPromptHeading.textContent = 'Prompt pour Codex ou un agent navigateur';
        elAiPromptDescription.textContent = 'L’agent reçoit la procédure pour rechercher, importer, contrôler et corriger la frise seul.';
    } else {
        elAiPromptHeading.textContent = 'Prompt pour ChatGPT ou un chatbot';
        elAiPromptDescription.textContent = 'Le chatbot prépare un JSON que vous pourrez importer à l’étape 3.';
    }
    updateAiPrompt();
}

function updateAiPrompt() {
    if (elAiPrompt) elAiPrompt.value = buildAiPrompt(elAiTopic?.value, readAiPromptOptions());
}

async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
}

elAiTopic?.addEventListener('input', updateAiPrompt);
[elAiEventCount, elAiPeriodCount, elAiImageMode].forEach(control => {
    control?.addEventListener('input', updateAiPrompt);
    control?.addEventListener('change', updateAiPrompt);
});
document.querySelectorAll('[data-ai-prompt-mode]').forEach(button => {
    button.addEventListener('click', () => setAiPromptMode(button.dataset.aiPromptMode));
});
document.getElementById('copy-ai-prompt')?.addEventListener('click', async () => {
    const button = document.getElementById('copy-ai-prompt');
    try {
        await copyText(elAiPrompt.value);
        button.dataset.copyState = 'success';
        showToast('Prompt copié. Vous pouvez le coller dans votre IA.');
    } catch (error) {
        button.dataset.copyState = 'error';
        showToast('La copie automatique a échoué. Sélectionnez le prompt manuellement.', 'error');
    }
});

document.getElementById('import-ai-json')?.addEventListener('click', () => {
    elAiImportStatus.className = '';
    try {
        applyTimelinePayload(elAiJsonInput.value, { adaptiveEventWidth: true });
        elAiImportStatus.textContent = `${state.events.length} événements et ${state.periods.length} périodes importés.`;
        elAiImportStatus.classList.add('is-success');
        setMobileView('canvas');
        window.setTimeout(() => toggleAiModal(false), 450);
    } catch (error) {
        elAiImportStatus.textContent = error.message || 'Le JSON n’est pas valide.';
        elAiImportStatus.classList.add('is-error');
    }
});

function readEventFormPayload(form, target = {}, imageData = undefined) {
    const image = imageData === undefined ? target.image || null : imageData || target.image || null;
    const position = parseTimelineCoordinate(form.value.value, target.value ?? state.start);
    return {
        title: form.title.value || 'Événement',
        value: position.value,
        date: position.date,
        font: form.font.value,
        fontSize: toNumber(form.fontSize.value, target.fontSize ?? 14),
        width: Math.min(480, Math.max(120, toNumber(form.width.value, target.width ?? 120))),
        height: target.height !== null
            && target.height !== undefined
            && target.height !== ''
            && Number.isFinite(Number(target.height))
            ? Number(target.height)
            : null,
        autoWidth: false,
        textColor: form.textColor.value,
        backgroundColor: form.backgroundColor.value,
        backgroundOpacity: toNumber(form.backgroundOpacity.value, target.backgroundOpacity ?? 1),
        connectorColor: form.connectorColor.value,
        showDate: form.showDate.checked,
        showTitle: form.showTitle.checked,
        showDetail: form.showDetail.checked,
        detail: form.detail.value || '',
        image,
        imageWidth: toNumber(form.imageWidth.value, target.imageWidth ?? 120),
        imageHeight: toNumber(form.imageHeight.value, target.imageHeight ?? 90),
        offsetX: target.offsetX || 0,
        offsetY: target.offsetY || 0,
        visible: target.visible !== false
    };
}

function readPeriodFormPayload(form, target = {}, imageData = undefined) {
    const startPosition = parseTimelineCoordinate(form.start.value, target.start ?? state.start);
    const endPosition = parseTimelineCoordinate(form.end.value, target.end ?? state.end);
    const isReversed = startPosition.value > endPosition.value;
    const image = imageData === undefined ? target.image || null : imageData || target.image || null;
    return {
        title: form.title.value || 'Période',
        start: isReversed ? endPosition.value : startPosition.value,
        end: isReversed ? startPosition.value : endPosition.value,
        startDate: isReversed ? endPosition.date : startPosition.date,
        endDate: isReversed ? startPosition.date : endPosition.date,
        style: form.style.value,
        thickness: toNumber(form.thickness.value, target.thickness ?? 4),
        rectHeight: toNumber(form.rectHeight.value, target.rectHeight ?? 44),
        titleAlignment: form.titleAlignment.value,
        fillColor: form.fillColor.value,
        fillOpacity: toNumber(form.fillOpacity.value, target.fillOpacity ?? 0.45),
        textColor: form.textColor.value,
        strokeColor: form.strokeColor.value,
        font: form.font.value,
        fontSize: toNumber(form.fontSize.value, target.fontSize ?? 14),
        showDate: form.showDate.checked,
        showTitle: form.showTitle.checked,
        showDetail: form.showDetail.checked,
        detail: form.detail.value || '',
        image,
        imageWidth: toNumber(form.imageWidth.value, target.imageWidth ?? 120),
        imageHeight: toNumber(form.imageHeight.value, target.imageHeight ?? 80),
        offsetX: target.offsetX || 0,
        offsetY: target.offsetY || 0,
        visible: target.visible !== false
    };
}

function fillEventForm(item) {
    eventForm.title.value = item.title;
    eventForm.value.value = item.date
        ? formatEditableTimelineValue(item.value, item.date)
        : String(item.value);
    eventForm.font.value = item.font;
    eventForm.fontSize.value = item.fontSize;
    eventForm.textColor.value = item.textColor;
    eventForm.backgroundColor.value = item.backgroundColor;
    eventForm.backgroundOpacity.value = item.backgroundOpacity ?? 1;
    eventForm.detail.value = item.detail || '';
    eventForm.width.value = item.width || 120;
    eventForm.connectorColor.value = item.connectorColor || '#0f172a';
    eventForm.showDate.checked = item.showDate !== false;
    eventForm.showTitle.checked = item.showTitle !== false;
    eventForm.showDetail.checked = item.showDetail !== false;
    eventForm.imageWidth.value = item.imageWidth || 120;
    eventForm.imageHeight.value = item.imageHeight || 90;
    eventForm.image.value = '';
}

function fillPeriodForm(item) {
    periodForm.title.value = item.title;
    periodForm.start.value = item.startDate
        ? formatEditableTimelineValue(item.start, item.startDate)
        : String(item.start);
    periodForm.end.value = item.endDate
        ? formatEditableTimelineValue(item.end, item.endDate)
        : String(item.end);
    periodForm.style.value = item.style;
    periodForm.fillOpacity.value = item.fillOpacity ?? 0.45;
    periodForm.fillColor.value = item.fillColor;
    periodForm.textColor.value = item.textColor;
    periodForm.strokeColor.value = item.strokeColor;
    periodForm.fontSize.value = item.fontSize;
    periodForm.font.value = item.font;
    periodForm.thickness.value = item.thickness ?? 4;
    periodForm.titleAlignment.value = item.titleAlignment || 'middle';
    periodForm.showDate.checked = item.showDate !== false;
    periodForm.showTitle.checked = item.showTitle !== false;
    periodForm.showDetail.checked = item.showDetail !== false;
    periodForm.rectHeight.value = item.rectHeight || 44;
    periodForm.detail.value = item.detail || '';
    periodForm.imageWidth.value = item.imageWidth || 120;
    periodForm.imageHeight.value = item.imageHeight || 80;
    periodForm.image.value = '';
}

function startEditing(type, id, scrollToForm = true) {
    if (type === 'event') {
        const item = state.events.find(ev => ev.id === id);
        if (!item) return;
        editingEventId = id;
        editingPeriodId = null;
        eventSubmitBtn.textContent = 'Mettre à jour';
        periodSubmitBtn.textContent = 'Ajouter';
        fillEventForm(item);
        if (scrollToForm) eventForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        const item = state.periods.find(pe => pe.id === id);
        if (!item) return;
        editingPeriodId = id;
        editingEventId = null;
        periodSubmitBtn.textContent = 'Mettre à jour';
        eventSubmitBtn.textContent = 'Ajouter';
        fillPeriodForm(item);
        if (scrollToForm) periodForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    renderTimeline();
}

const eventForm = document.getElementById('event-form');
eventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const imageFile = data.get('image');
    const imgData = imageFile && imageFile.size ? await loadImage(imageFile) : null;
    const target = editingEventId ? state.events.find(ev => ev.id === editingEventId) : null;
    const payload = readEventFormPayload(e.target, target || {}, imgData);

    if (editingEventId) {
        if (target) Object.assign(target, payload);
        editingEventId = null;
        eventSubmitBtn.textContent = "Ajouter l'événement";
    } else {
        state.events.push({ id: createId('event'), ...payload });
    }
    e.target.reset();
    renderTimeline();
});

const periodForm = document.getElementById('period-form');
periodForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const imageFile = data.get('image');
    const imgData = imageFile && imageFile.size ? await loadImage(imageFile) : null;
    const target = editingPeriodId ? state.periods.find(pe => pe.id === editingPeriodId) : null;
    const payload = readPeriodFormPayload(e.target, target || {}, imgData);

    if (editingPeriodId) {
        if (target) Object.assign(target, payload);
        editingPeriodId = null;
        periodSubmitBtn.textContent = "Ajouter la période";
    } else {
        state.periods.push({ id: createId('period'), ...payload });
    }
    e.target.reset();
    renderTimeline();
});

eventForm.addEventListener('input', () => {
    if (!editingEventId) return;
    const target = state.events.find(ev => ev.id === editingEventId);
    if (!target) return;
    Object.assign(target, readEventFormPayload(eventForm, target));
    renderTimeline({ coalesceHistory: true });
});

periodForm.addEventListener('input', () => {
    if (!editingPeriodId) return;
    const target = state.periods.find(pe => pe.id === editingPeriodId);
    if (!target) return;
    Object.assign(target, readPeriodFormPayload(periodForm, target));
    renderTimeline({ coalesceHistory: true });
});

eventForm.image.addEventListener('change', async () => {
    if (!editingEventId) return;
    const target = state.events.find(ev => ev.id === editingEventId);
    const file = eventForm.image.files?.[0];
    if (!target || !file) return;
    target.image = await loadImage(file);
    renderTimeline();
});

periodForm.image.addEventListener('change', async () => {
    if (!editingPeriodId) return;
    const target = state.periods.find(pe => pe.id === editingPeriodId);
    const file = periodForm.image.files?.[0];
    if (!target || !file) return;
    target.image = await loadImage(file);
    renderTimeline();
});

function valueToX(val) {
    const span = Math.max(state.end - state.start, 1e-6);
    const pxPerMain = state.mmPerMain * pxPerMm;
    return state.padding + ((val - state.start) / state.mainStep) * pxPerMain;
}

function timelineWidth() {
    const span = Math.max(state.end - state.start, 1e-6);
    const pxPerMain = state.mmPerMain * pxPerMm;
    return state.padding * 2 + (span / state.mainStep) * pxPerMain;
}

function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderGuides() {
    const guideLayer = document.createElement('div');
    guideLayer.className = 'guide-layer';
    const size = A4[state.orientation];
    const pageW = size.w * pxPerMm;
    const pageH = size.h * pxPerMm;

    // Vertical guides (pages width)
    for (let x = pageW; x < timelineWidth(); x += pageW) {
        const line = document.createElement('div');
        line.className = 'guide guide-vert';
        line.style.left = `${x}px`;
        guideLayer.appendChild(line);
    }

    // Horizontal guides (pages height) - Centered on baseline
    // Baseline is at state.timelineHeight / 2
    // We want a page center to align with baseline.
    // So grid starts at (timelineHeight/2) - (pageH/2)
    const centerY = state.timelineHeight / 2;
    const gridOriginY = centerY - pageH / 2;

    // Find first visible line
    // lineY = gridOriginY + k * pageH
    // We want lineY >= 0 (or slightly before)
    // k * pageH >= -gridOriginY => k >= -gridOriginY / pageH
    const startK = Math.floor(-gridOriginY / pageH);

    for (let k = startK; ; k++) {
        const y = gridOriginY + k * pageH;
        if (y > state.timelineHeight) break;

        if (y >= 0 && y <= state.timelineHeight) {
            const line = document.createElement('div');
            line.className = 'guide guide-horiz';
            line.style.top = `${y}px`;
            guideLayer.appendChild(line);
        }
    }

    elTimeline.appendChild(guideLayer);
}

function renderAxis() {
    const baseY = Number(state.timelineHeight) / 2;
    const axis = document.createElement('div');
    axis.className = 'baseline';
    axis.style.top = `${baseY}px`;
    axis.style.background = state.baselineColor;
    elTimeline.appendChild(axis);

    for (let v = state.start; v <= state.end + 1e-6; v += state.mainStep) {
        const x = valueToX(v);
        const tick = document.createElement('div');
        tick.className = 'tick main';
        tick.style.left = `${x}px`;
        tick.style.height = `${state.mainTickHeight}px`;
        tick.style.top = `${baseY - state.mainTickHeight}px`;
        tick.style.background = state.mainTickColor;
        elTimeline.appendChild(tick);

        if (state.secondaryPerMain > 0 && v + state.mainStep <= state.end + 1e-6) {
            for (let i = 1; i < state.secondaryPerMain; i++) {
                const ratio = i / state.secondaryPerMain;
                const xv = valueToX(v + ratio * state.mainStep);
                const sTick = document.createElement('div');
                sTick.className = 'tick secondary';
                sTick.style.left = `${xv}px`;
                sTick.style.height = `${state.secondaryTickHeight}px`;
                sTick.style.top = `${baseY - state.secondaryTickHeight}px`;
                sTick.style.background = state.secondaryTickColor;
                elTimeline.appendChild(sTick);

                if (state.showSecondaryLabels) {
                    const sLbl = document.createElement('div');
                    sLbl.className = 'tick-label secondary';
                    sLbl.style.top = `${baseY + state.secondaryLabelOffset}px`;
                    sLbl.style.color = state.secondaryLabelColor;
                    sLbl.style.fontSize = `${state.secondaryLabelSize}px`;
                    sLbl.style.fontFamily = state.secondaryLabelFont || state.labelFont;
                    const secondaryValue = v + ratio * state.mainStep;
                    sLbl.textContent = state.mainStep < 1
                        ? formatTimelineValue(secondaryValue)
                        : String(Number(secondaryValue.toFixed(6)));
                    sLbl.style.left = `${xv}px`;
                    elTimeline.appendChild(sLbl);
                }
            }
        }

        const lbl = document.createElement('div');
        lbl.className = 'tick-label';
        lbl.style.top = `${baseY + state.labelOffset}px`;
        lbl.style.color = state.labelColor;
        lbl.style.fontSize = `${state.labelSize}px`;
        lbl.style.fontFamily = state.labelFont;
        lbl.textContent = state.mainStep < 1
            ? formatTimelineValue(v)
            : String(Number(v.toFixed(6)));
        lbl.style.left = `${x}px`;
        elTimeline.appendChild(lbl);
    }
}

function renderEvents() {
    const baseY = Number(state.timelineHeight) / 2 + Number(state.eventBaseOffset);
    const lines = [];
    state.events.forEach(evt => {
        if (evt.visible === false) return;
        const card = document.createElement('div');
        card.className = 'event draggable';
        if (editingEventId === evt.id) card.classList.add('is-editing');
        card.dataset.id = evt.id;
        card.dataset.type = 'event';
        card.style.backgroundColor = hexToRgba(evt.backgroundColor || '#fff', evt.backgroundOpacity ?? 1);
        card.style.fontFamily = evt.font;
        card.style.color = evt.textColor;
        card.style.width = `${evt.width || 120}px`;
        const hasCustomHeight = evt.height !== null
            && evt.height !== undefined
            && evt.height !== ''
            && Number.isFinite(Number(evt.height));
        if (hasCustomHeight) {
            card.style.height = `${evt.height}px`;
        }
        card.style.borderColor = evt.connectorColor || '#0f172a';
        card.style.setProperty('--event-accent', evt.connectorColor || '#0f172a');
        card.dataset.resizeMode = 'corners';

        if (evt.showTitle !== false) {
            const title = document.createElement('div');
            title.className = 'label';
            title.textContent = evt.title;
            title.style.fontSize = `${evt.fontSize * 1.15}px`;
            card.appendChild(title);
        }

        if (evt.showDate !== false) {
            const date = document.createElement('div');
            date.className = 'date';
            date.textContent = formatTimelineValue(evt.value, evt.date);
            card.appendChild(date);
        }

        if (evt.detail && evt.showDetail !== false) {
            const detail = document.createElement('div');
            detail.className = 'date event-detail';
            detail.style.marginTop = '4px';
            detail.textContent = evt.detail;
            detail.style.fontSize = `${evt.fontSize * 0.9}px`;
            card.appendChild(detail);
        }

        appendItemImage(card, evt, evt.imageWidth || evt.width || 120, evt.imageHeight || 90);

        elTimeline.appendChild(card);
        if (hasCustomHeight) {
            const borderHeight = card.offsetHeight - card.clientHeight;
            const safeHeight = Math.max(Number(evt.height), card.scrollHeight + borderHeight);
            card.style.height = `${safeHeight}px`;
        }

        const centerX = valueToX(evt.value) + (evt.offsetX || 0);
        const topY = baseY + (evt.offsetY || 0);
        card.style.left = `${centerX - card.offsetWidth / 2}px`;
        card.style.top = `${topY}px`;

        const baselineY = Number(state.timelineHeight) / 2;
        const yStart = (topY + card.offsetHeight / 2) < baselineY ? (topY + card.offsetHeight) : topY;
        lines.push({
            id: evt.id,
            x1: centerX,
            y1: yStart,
            x2: valueToX(evt.value),
            y2: baselineY,
            color: evt.connectorColor || '#0f172a'
        });
    });
    return lines;
}

function periodLabelText(per) {
    const hasTitle = per.showTitle !== false;
    const hasDates = per.showDate !== false;
    const dateRange = `${formatTimelineValue(per.start, per.startDate)} – ${formatTimelineValue(per.end, per.endDate)}`;
    if (hasTitle && hasDates) return `${per.title} (${dateRange})`;
    if (hasTitle) return per.title;
    if (hasDates) return dateRange;
    return '';
}

function appendItemImage(container, item, width, height) {
    if (!item.image) return;
    const img = document.createElement('img');
    img.className = 'item-image';
    if (/^https:\/\//i.test(item.image)) {
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';
    }
    img.src = item.image;
    img.alt = item.imageAlt || item.title || '';
    if (item.imageCredit) img.title = item.imageCredit;
    if (item.imageSourceUrl) img.dataset.sourceUrl = item.imageSourceUrl;
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    container.appendChild(img);
}

function createPeriodContent(per, labelText, { callout = false } = {}) {
    const content = document.createElement('div');
    content.className = callout ? 'period-content period-callout' : 'period-content';
    content.style.setProperty('--period-accent', per.strokeColor);

    if (labelText) {
        const label = document.createElement('div');
        label.className = 'period-label';
        label.textContent = labelText;
        label.style.color = per.textColor;
        label.style.fontFamily = per.font;
        label.style.fontSize = `${per.fontSize}px`;
        content.appendChild(label);
    }

    if (per.detail && per.showDetail !== false) {
        const detail = document.createElement('div');
        detail.className = 'period-detail';
        detail.textContent = per.detail;
        detail.style.color = per.textColor;
        detail.style.fontFamily = per.font;
        detail.style.fontSize = `${per.fontSize * 0.85}px`;
        detail.style.opacity = '0.9';
        content.appendChild(detail);
    }

    appendItemImage(content, per, per.imageWidth || 120, per.imageHeight || 80);
    return content;
}

function estimatePeriodLabelWidth(per, labelText) {
    if (!labelText) return 0;
    const canvas = estimatePeriodLabelWidth.canvas
        || (estimatePeriodLabelWidth.canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    if (!context) return labelText.length * per.fontSize * 0.58;
    context.font = `700 ${per.fontSize}px "${per.font || 'DM Sans'}"`;
    return context.measureText(labelText).width;
}

function periodNeedsExternalLabel(per, width, labelText) {
    if (!labelText && !(per.detail && per.showDetail !== false) && !per.image) return false;
    const labelRequirement = Math.min(220, estimatePeriodLabelWidth(per, labelText) * 0.62 + 22);
    const detailRequirement = per.detail && per.showDetail !== false ? 148 : 0;
    const imageRequirement = per.image ? Math.min(240, (per.imageWidth || 120) + 20) : 0;
    return width < Math.max(92, labelRequirement, detailRequirement, imageRequirement);
}

function positionPeriodCallout(callout, periodX, periodWidth) {
    const calloutWidth = callout.offsetWidth;
    const timelineContentWidth = timelineWidth();
    const segmentCenter = periodX + periodWidth / 2;
    const halfCallout = calloutWidth / 2;
    const calloutCenter = Math.min(
        Math.max(segmentCenter, halfCallout + 12),
        timelineContentWidth - halfCallout - 12
    );
    const localCenter = calloutCenter - periodX;
    const anchorWithinCallout = halfCallout + segmentCenter - calloutCenter;
    callout.style.left = `${localCenter}px`;
    callout.style.setProperty('--callout-anchor-x', `${anchorWithinCallout}px`);
}

function renderPeriods() {
    const baseY = Number(state.timelineHeight) / 2 + Number(state.periodBaseOffset);
    state.periods.forEach(per => {
        if (per.visible === false) return;
        const wrap = document.createElement('div');
        wrap.className = `period draggable period-${per.style}`;
        if (editingPeriodId === per.id) wrap.classList.add('is-editing');
        wrap.dataset.id = per.id;
        wrap.dataset.type = 'period';
        const startX = valueToX(per.start);
        const endX = valueToX(per.end);
        const width = Math.max(12, endX - startX);
        const x = startX + (per.offsetX || 0);
        const y = baseY + (per.offsetY || 0);
        wrap.style.left = `${x}px`;
        wrap.style.top = `${y}px`;
        wrap.style.width = `${width}px`;

        const labelText = periodLabelText(per);
        const thickness = per.thickness ?? 4;
        const rectHeight = per.rectHeight ?? 44;
        const align = per.titleAlignment || 'middle';

        if (per.style === 'rect') {
            wrap.style.background = hexToRgba(per.fillColor, per.fillOpacity ?? 0.45);
            wrap.style.border = `${thickness}px solid ${hexToRgba(per.strokeColor, Math.min(1, (per.fillOpacity ?? 0.45) + 0.1))}`;
            wrap.style.height = `${rectHeight}px`;
            wrap.style.overflow = per.image ? 'visible' : 'hidden';
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';
            wrap.style.alignItems = 'center';
            wrap.style.justifyContent = align === 'top' ? 'flex-start' : align === 'bottom' ? 'flex-end' : 'center';
            const content = createPeriodContent(per, labelText);
            wrap.appendChild(content);
            elTimeline.appendChild(wrap);

            if (periodNeedsExternalLabel(per, width, labelText)) {
                content.remove();
                wrap.classList.add('has-external-label');
                wrap.style.overflow = 'visible';
                const callout = createPeriodContent(per, labelText, { callout: true });
                wrap.appendChild(callout);
                positionPeriodCallout(callout, x, width);
            } else if (content.scrollHeight > wrap.clientHeight + 1) {
                wrap.style.height = `${content.scrollHeight + thickness * 2}px`;
            }
        } else {
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';
            wrap.style.alignItems = 'center';
            wrap.style.gap = align === 'middle' ? '0' : '6px';
            wrap.style.overflow = 'visible';
            const line = document.createElement('div');
            line.className = 'line';
            line.style.background = per.strokeColor;
            line.style.opacity = per.fillOpacity ?? 0.45;
            line.style.height = `${thickness}px`;
            line.style.position = 'relative';
            line.style.width = '100%';

            const capStart = document.createElement('div');
            capStart.className = 'cap start';
            capStart.style.background = per.strokeColor;
            capStart.style.opacity = per.fillOpacity ?? 1;
            line.appendChild(capStart);

            const capEnd = document.createElement('div');
            capEnd.className = 'cap end';
            capEnd.style.background = per.strokeColor;
            capEnd.style.opacity = per.fillOpacity ?? 1;
            line.appendChild(capEnd);

            const labelContainer = createPeriodContent(per, labelText);
            labelContainer.style.pointerEvents = 'none';

            if (periodNeedsExternalLabel(per, width, labelText)) {
                wrap.classList.add('has-external-label');
                wrap.appendChild(line);
                const callout = createPeriodContent(per, labelText, { callout: true });
                wrap.appendChild(callout);
                elTimeline.appendChild(wrap);
                positionPeriodCallout(callout, x, width);
            } else if (align === 'top') {
                wrap.appendChild(labelContainer);
                wrap.appendChild(line);
            } else if (align === 'bottom') {
                wrap.appendChild(line);
                wrap.appendChild(labelContainer);
            } else {
                wrap.appendChild(line);
                const overlay = labelContainer;
                overlay.style.position = 'absolute';
                overlay.style.top = '50%';
                overlay.style.left = '50%';
                overlay.style.transform = 'translate(-50%, -50%)';
                overlay.style.width = 'max-content';
                overlay.style.maxWidth = `${Math.max(width + 100, 200)}px`; // Allow some overflow for centered text
                wrap.style.padding = `${Math.max(8, per.fontSize)}px 0`;
                wrap.appendChild(overlay);
            }
        }
        if (!wrap.isConnected) elTimeline.appendChild(wrap);
    });
}

function renderConnectors(lines) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', timelineWidth());
    svg.setAttribute('height', state.timelineHeight);
    svg.classList.add('connector-layer');
    lines.forEach(line => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        el.dataset.eventId = line.id;
        el.setAttribute('x1', line.x1);
        el.setAttribute('y1', line.y1);
        el.setAttribute('x2', line.x2);
        el.setAttribute('y2', line.y2);
        el.style.stroke = line.color || 'rgba(15,23,42,0.45)';
        svg.appendChild(el);
    });
    elTimeline.appendChild(svg);
}

function eventResizeCorner(pointerEvent, element) {
    const rect = element.getBoundingClientRect();
    const zone = pointerEvent.pointerType === 'touch' ? 24 : 14;
    const x = pointerEvent.clientX - rect.left;
    const y = pointerEvent.clientY - rect.top;
    const horizontal = x <= zone ? 'left' : x >= rect.width - zone ? 'right' : null;
    const vertical = y <= zone ? 'top' : y >= rect.height - zone ? 'bottom' : null;
    return horizontal && vertical ? `${vertical}-${horizontal}` : null;
}

function resizeCursor(corner) {
    return corner === 'top-left' || corner === 'bottom-right' ? 'nwse-resize' : 'nesw-resize';
}

function updateEventConnectorPreview(card, id) {
    const line = Array.from(elTimeline.querySelectorAll('.connector-layer line'))
        .find(candidate => candidate.dataset.eventId === id);
    const target = state.events.find(event => event.id === id);
    if (!line || !target) return;
    const cardRect = card.getBoundingClientRect();
    const timelineRect = elTimeline.getBoundingClientRect();
    const left = (cardRect.left - timelineRect.left) / timelineZoom;
    const top = (cardRect.top - timelineRect.top) / timelineZoom;
    const width = cardRect.width / timelineZoom;
    const height = cardRect.height / timelineZoom;
    const baselineY = Number(state.timelineHeight) / 2;
    const centerX = left + width / 2;
    const yStart = (top + height / 2) < baselineY ? top + height : top;
    line.setAttribute('x1', centerX);
    line.setAttribute('y1', yStart);
    line.setAttribute('x2', valueToX(target.value));
    line.setAttribute('y2', baselineY);
}

function attachDrag() {
    const items = elTimeline.querySelectorAll('.draggable');
    items.forEach(el => {
        if (el.dataset.type === 'event') {
            el.onpointermove = (event) => {
                if (el.dataset.interactionActive === 'true') return;
                const corner = eventResizeCorner(event, el);
                el.style.cursor = corner ? resizeCursor(corner) : 'grab';
            };
            el.onpointerleave = () => {
                if (el.dataset.interactionActive !== 'true') el.style.cursor = 'grab';
            };
        }

        el.onpointerdown = (ev) => {
            ev.preventDefault();
            const id = el.dataset.id;
            const type = el.dataset.type;
            const corner = type === 'event' ? eventResizeCorner(ev, el) : null;
            const isResizing = Boolean(corner);
            const startX = ev.clientX;
            const startY = ev.clientY;
            const rect = el.getBoundingClientRect();
            const timelineRect = elTimeline.getBoundingClientRect();
            const initialLeft = (rect.left - timelineRect.left) / timelineZoom;
            const initialTop = (rect.top - timelineRect.top) / timelineZoom;
            const width = rect.width / timelineZoom;
            const height = rect.height / timelineZoom;
            el.dataset.interactionActive = 'true';
            el.style.cursor = isResizing ? resizeCursor(corner) : 'grabbing';
            el.setPointerCapture?.(ev.pointerId);

            const onMove = (eMove) => {
                const dx = (eMove.clientX - startX) / timelineZoom;
                const dy = (eMove.clientY - startY) / timelineZoom;
                if (isResizing) {
                    const resizeFromLeft = corner.endsWith('left');
                    const resizeFromTop = corner.startsWith('top');
                    const desiredWidth = Math.min(480, Math.max(120, width + (resizeFromLeft ? -dx : dx)));
                    const desiredHeight = Math.min(720, Math.max(72, height + (resizeFromTop ? -dy : dy)));
                    const left = resizeFromLeft ? initialLeft + width - desiredWidth : initialLeft;

                    el.style.width = `${desiredWidth}px`;
                    el.style.height = `${desiredHeight}px`;
                    const borderHeight = el.offsetHeight - el.clientHeight;
                    const safeHeight = Math.max(desiredHeight, el.scrollHeight + borderHeight);
                    const top = resizeFromTop ? initialTop + height - safeHeight : initialTop;
                    el.style.left = `${left}px`;
                    el.style.top = `${top}px`;
                    el.style.height = `${safeHeight}px`;
                    updateEventConnectorPreview(el, id);
                } else if (type === 'period') {
                    el.style.top = `${initialTop + dy}px`;
                } else {
                    el.style.left = `${initialLeft + dx}px`;
                    el.style.top = `${initialTop + dy}px`;
                    updateEventConnectorPreview(el, id);
                }
            };

            const onUp = (eUp) => {
                const dx = (eUp.clientX - startX) / timelineZoom;
                const dy = (eUp.clientY - startY) / timelineZoom;
                const didDrag = Math.hypot(eUp.clientX - startX, eUp.clientY - startY) > 4;
                const target = type === 'event'
                    ? state.events.find(ev => ev.id === id)
                    : state.periods.find(pe => pe.id === id);
                if (target && didDrag) {
                    if (type === 'event') {
                        const baseX = valueToX(target.value);
                        const baseY = Number(state.timelineHeight) / 2 + Number(state.eventBaseOffset);
                        if (isResizing) {
                            const finalRect = el.getBoundingClientRect();
                            const finalLeft = (finalRect.left - timelineRect.left) / timelineZoom;
                            const finalTop = (finalRect.top - timelineRect.top) / timelineZoom;
                            const finalWidth = finalRect.width / timelineZoom;
                            const finalHeight = finalRect.height / timelineZoom;
                            target.width = Math.round(finalWidth);
                            target.height = Math.round(finalHeight);
                            target.autoWidth = false;
                            target.offsetX = (finalLeft + finalWidth / 2) - baseX;
                            target.offsetY = finalTop - baseY;
                            if (editingEventId === target.id) fillEventForm(target);
                        } else {
                            target.offsetX = (initialLeft + dx + width / 2) - baseX;
                            target.offsetY = (initialTop + dy) - baseY;
                        }
                    } else {
                        const baseY = Number(state.timelineHeight) / 2 + Number(state.periodBaseOffset);
                        target.offsetX = 0;
                        target.offsetY = (initialTop + dy) - baseY;
                    }
                }
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
                el.releasePointerCapture?.(ev.pointerId);
                delete el.dataset.interactionActive;
                el.style.cursor = type === 'event' ? 'grab' : '';
                if (didDrag) renderTimeline();
                else startEditing(type, id);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        };
    });
}

function renderList(container, items, type) {
    container.innerHTML = '';
    const icons = {
        visible: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/></svg>',
        hidden: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 3l18 18M10.5 6.2A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15.3 15.3 0 0 1-2.2 2.8M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-1"/></svg>',
        edit: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20l4.2-1 10.6-10.6-3.2-3.2L5 15.8zM13.9 6.9l3.2 3.2"/></svg>',
        delete: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>'
    };

    items.forEach(item => {
        const pill = document.createElement('div');
        pill.className = 'pill';
        if (item.visible === false) pill.classList.add('pill-muted');
        if ((type === 'event' && editingEventId === item.id) || (type === 'period' && editingPeriodId === item.id)) {
            pill.classList.add('pill-active');
        }
        const label = document.createElement('span');
        label.textContent = type === 'event'
            ? `${item.title} : ${formatTimelineValue(item.value, item.date)}`
            : `${item.title} : ${formatTimelineValue(item.start, item.startDate)}–${formatTimelineValue(item.end, item.endDate)}`;
        pill.appendChild(label);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.innerHTML = item.visible === false ? icons.hidden : icons.visible;
        toggle.title = item.visible === false ? 'Afficher' : 'Masquer';
        toggle.setAttribute('aria-label', `${toggle.title} ${item.title}`);
        toggle.addEventListener('click', () => {
            item.visible = !item.visible;
            renderTimeline();
        });
        pill.appendChild(toggle);

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.innerHTML = icons.edit;
        edit.title = 'Modifier';
        edit.setAttribute('aria-label', `Modifier ${item.title}`);
        edit.addEventListener('click', () => {
            startEditing(type, item.id);
        });
        pill.appendChild(edit);

        const del = document.createElement('button');
        del.type = 'button';
        del.innerHTML = icons.delete;
        del.title = 'Supprimer';
        del.setAttribute('aria-label', `Supprimer ${item.title}`);
        del.addEventListener('click', () => {
            if (type === 'event') {
                state.events = state.events.filter(ev => ev.id !== item.id);
                if (editingEventId === item.id) {
                    editingEventId = null;
                    eventSubmitBtn.textContent = "Ajouter";
                    eventForm.reset();
                }
            } else {
                state.periods = state.periods.filter(pe => pe.id !== item.id);
                if (editingPeriodId === item.id) {
                    editingPeriodId = null;
                    periodSubmitBtn.textContent = "Ajouter";
                    periodForm.reset();
                }
            }
            renderTimeline();
        });
        pill.appendChild(del);

        container.appendChild(pill);
    });
}

function renderTimeline({ coalesceHistory = false } = {}) {
    if (state.end <= state.start) state.end = state.start + 1;
    const totalItems = state.events.length + state.periods.length;
    elTimeline.innerHTML = '';
    elTimeline.style.background = state.backgroundColor;
    elTimeline.style.height = `${state.timelineHeight}px`;
    elTimeline.style.width = `${timelineWidth()}px`;
    elTimeline.style.zoom = String(timelineZoom);
    renderGuides();
    renderAxis();
    renderPeriods();
    const lines = renderEvents();
    renderConnectors(lines);
    attachDrag();
    renderList(elEventList, state.events, 'event');
    renderList(elPeriodList, state.periods, 'period');

    if (document.activeElement !== elCanvasTitle) {
        elCanvasTitle.textContent = state.title || 'Ma frise chronologique';
    }
    elTimelineMeta.textContent = `${totalItems} élément${totalItems > 1 ? 's' : ''} · ${formatTimelineValue(state.start)}–${formatTimelineValue(state.end)}`;
    elEmptyState.hidden = totalItems > 0;

    document.getElementById('event-count').textContent = state.events.length;
    document.getElementById('period-count').textContent = state.periods.length;
    document.getElementById('event-list-count').textContent = state.events.length;
    document.getElementById('period-list-count').textContent = state.periods.length;
    document.getElementById('event-list-empty').hidden = state.events.length > 0;
    document.getElementById('period-list-empty').hidden = state.periods.length > 0;
    elTimeline.dataset.eventCount = String(state.events.length);
    elTimeline.dataset.periodCount = String(state.periods.length);
    elTimeline.dataset.agentVersion = '1.3';

    trackHistory({ coalesce: coalesceHistory });
    persistDraft();
    window.dispatchEvent(new CustomEvent('timeline:statechange', {
        detail: {
            version: '1.3',
            eventCount: state.events.length,
            periodCount: state.periods.length
        }
    }));
}

async function ensureLibs() {
    const loadScript = (src) => new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = reject;
        document.head.appendChild(el);
    });
    if (!window.html2canvas) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    if (!window.jspdf) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }
}

async function exportCanvas() {
    await ensureLibs();
    const rawScale = state.exportScale || 4;
    const safeScale = Math.max(0.5, rawScale); // pas de limite haute pour laisser exporter les grandes frises
    const previousZoom = elTimeline.style.zoom;
    elTimeline.style.zoom = '1';
    try {
        return await html2canvas(elTimeline, {
            scale: safeScale,
            backgroundColor: null,
            useCORS: true,
            logging: false
        });
    } finally {
        elTimeline.style.zoom = previousZoom;
    }
}

document.getElementById('save-image').addEventListener('click', async () => {
    const button = document.getElementById('save-image');
    button.disabled = true;
    button.dataset.exportState = 'working';
    delete button.dataset.exportError;
    elTimeline.classList.add('exporting');
    try {
        const canvas = await exportCanvas();
        const link = document.createElement('a');
        link.download = 'frise.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        button.dataset.exportState = 'success';
        showToast('Export PNG généré.');
    } catch (error) {
        button.dataset.exportState = 'error';
        button.dataset.exportError = String(error?.message || error).slice(0, 180);
        showToast('L’export PNG a échoué. Vérifiez votre connexion puis réessayez.', 'error');
    } finally {
        button.disabled = false;
        elTimeline.classList.remove('exporting');
    }
});

document.getElementById('export-pdf').addEventListener('click', async () => {
    const button = document.getElementById('export-pdf');
    button.disabled = true;
    button.dataset.exportState = 'working';
    delete button.dataset.exportError;
    elTimeline.classList.add('exporting');
    try {
        const canvas = await exportCanvas();
        const scale = state.exportScale || 4;
        // Calculate dimensions in mm based on the canvas size and the scale used for generation
        const imgWidthMm = canvas.width / (pxPerMm * scale);
        const imgHeightMm = canvas.height / (pxPerMm * scale);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: state.orientation, unit: 'mm', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        // Calculate pixel dimensions for tiling based on the scale
        const pageWidthPx = pageWidth * pxPerMm * scale;
        const pageHeightPx = pageHeight * pxPerMm * scale;

        if (imgWidthMm <= pageWidth && imgHeightMm <= pageHeight) {
            const imgData = canvas.toDataURL('image/png');
            // Center vertically if it fits on one page
            const yOffset = (pageHeight - imgHeightMm) / 2;
            pdf.addImage(imgData, 'PNG', 0, Math.max(0, yOffset), imgWidthMm, imgHeightMm);
        } else {
            let first = true;

            // Tiling logic centered on baseline
            // Canvas baseline is at canvas.height / 2
            // We want a page center to align with canvas baseline.
            // gridOriginY = (canvas.height / 2) - (pageHeightPx / 2)
            const centerY = canvas.height / 2;
            const gridOriginY = centerY - pageHeightPx / 2;

            // Find start K
            const startK = Math.floor(-gridOriginY / pageHeightPx);

            // Step by page size in pixels (scaled)
            // We iterate through pages (k) and horizontal tiles (x)
            // We need to stop when gridOriginY + k * pageHeightPx > canvas.height

            for (let k = startK; ; k++) {
                const y = gridOriginY + k * pageHeightPx;
                if (y >= canvas.height) break;

                // If this row is completely outside (above), skip (though startK should prevent this)
                if (y + pageHeightPx <= 0) continue;

                for (let x = 0; x < canvas.width; x += pageWidthPx) {
                    // Determine source rectangle on canvas
                    // Source y can be negative if gridOriginY < 0. drawImage handles this? 
                    // No, drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
                    // sx, sy must be valid? Actually browsers might clip, but safer to clamp.

                    // We want to capture the area [x, y] to [x+pageWidthPx, y+pageHeightPx]
                    // But we must clip to canvas bounds [0, 0] to [canvas.width, canvas.height]

                    // Intersection of [x, x+tileW] and [0, canvasW]
                    // Intersection of [y, y+tileH] and [0, canvasH]

                    const sourceX = Math.max(0, x);
                    const sourceY = Math.max(0, y);
                    const sourceRight = Math.min(canvas.width, x + pageWidthPx);
                    const sourceBottom = Math.min(canvas.height, y + pageHeightPx);

                    const sW = sourceRight - sourceX;
                    const sH = sourceBottom - sourceY;

                    if (sW <= 0 || sH <= 0) continue;

                    const tileCanvas = document.createElement('canvas');
                    tileCanvas.width = pageWidthPx; // The PDF page size in pixels
                    tileCanvas.height = pageHeightPx;
                    const ctx = tileCanvas.getContext('2d');

                    // Draw the chunk into the tile canvas at the correct position
                    // If y < 0, then the content starts at destination y = -y
                    const destX = sourceX - x;
                    const destY = sourceY - y;

                    ctx.drawImage(canvas, sourceX, sourceY, sW, sH, destX, destY, sW, sH);

                    const tileImg = tileCanvas.toDataURL('image/png');

                    if (!first) pdf.addPage();
                    // Always fill the full PDF page
                    pdf.addImage(tileImg, 'PNG', 0, 0, pageWidth, pageHeight);
                    first = false;
                }
            }
        }
        pdf.save('frise.pdf');
        button.dataset.exportState = 'success';
        showToast('Export PDF généré.');
    } catch (error) {
        button.dataset.exportState = 'error';
        button.dataset.exportError = String(error?.message || error).slice(0, 180);
        showToast('L’export PDF a échoué. Vérifiez votre connexion puis réessayez.', 'error');
    } finally {
        button.disabled = false;
        elTimeline.classList.remove('exporting');
    }
});

document.getElementById('export-html').addEventListener('click', () => {
    const button = document.getElementById('export-html');
    button.dataset.exportState = 'working';
    // Clone the timeline to make a static version
    const clone = elTimeline.cloneNode(true);
    clone.style.zoom = '1';

    // Remove guide layer
    const guides = clone.querySelector('.guide-layer');
    if (guides) guides.remove();

    // Remove interactivity classes and attributes
    clone.querySelectorAll('.draggable').forEach(el => {
        el.classList.remove('draggable');
        el.style.cursor = 'default';
        delete el.dataset.id;
        delete el.dataset.type;
    });

    // Create a clean HTML document structure
    const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Frise exportée</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=DM+Sans:wght@400;500;600&family=Playfair+Display:wght@500&family=Roboto:wght@400;500&family=Poppins:wght@400;500&family=Montserrat:wght@500;600&family=Lora:wght@500&family=Manrope:wght@500;600&family=Open+Sans:wght@400;600&family=Lato:wght@400;700&family=Oswald:wght@500&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; padding: 20px; background: ${state.backgroundColor}; font-family: sans-serif; display: flex; justify-content: center; }
    /* Inline essential styles from style.css for the timeline */
    .timeline-container { position: relative; box-shadow: 0 10px 30px rgba(0,0,0,0.1); margin-left: 3cm; }
    ${Array.from(document.styleSheets)
            .filter(sheet => sheet.href && sheet.href.includes('style.css'))
            .map(sheet => {
                try {
                    return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
                } catch (e) { return ''; }
            }).join('\n')}
    /* Overrides for static view */
    #timeline-space { margin: 0 auto; box-shadow: none; }
    .guide-layer { display: none !important; }
  </style>
</head>
<body>
  <div class="timeline-container">
    ${clone.outerHTML}
  </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frise_export.html';
    a.click();
    URL.revokeObjectURL(url);
    button.dataset.exportState = 'success';
    showToast('Export HTML généré.');
});

document.getElementById('save-state').addEventListener('click', () => {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frise.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Frise enregistrée au format JSON.');
});

document.getElementById('load-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            applyTimelinePayload(reader.result);
        } catch (err) {
            showToast(err.message || 'Impossible de charger ce fichier.', 'error');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
});

document.getElementById('new-timeline').addEventListener('click', () => {
    if ((state.events.length || state.periods.length)
        && !window.confirm('Créer une nouvelle frise ? Votre brouillon actuel sera remplacé.')) {
        return;
    }

    Object.assign(state, JSON.parse(JSON.stringify(defaultState)));
    editingEventId = null;
    editingPeriodId = null;
    eventForm.reset();
    periodForm.reset();
    eventSubmitBtn.textContent = 'Ajouter l’événement';
    periodSubmitBtn.textContent = 'Ajouter la période';
    syncSettingsControls();
    renderTimeline();
    setMobileView('canvas');
    showToast('Nouvelle frise prête.');
});

function restoreDraft() {
    try {
        const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!draft) return false;
        Object.assign(state, normalizeTimelinePayload(draft));
        return true;
    } catch (error) {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        return false;
    }
}

function getAgentDescriptor() {
    let schema = null;
    try {
        schema = JSON.parse(document.getElementById('timeline-agent-schema').textContent);
    } catch (error) {
        schema = null;
    }
    return {
        name: 'Frise chronologique',
        version: '1.3',
        language: 'fr',
        description: 'Éditeur visuel de frises chronologiques pilotable par données structurées.',
        preferredFlow: [
            'Call describe() to inspect this contract.',
            'Build a valid payload with ISO dates when exact days are known.',
            'Call importState(payload).',
            'Call getState() to verify the imported result.'
        ],
        methods: {
            describe: 'Returns this descriptor and the JSON Schema.',
            getState: 'Returns a deep copy of the current timeline.',
            importState: 'Validates, normalizes and replaces the current timeline.',
            addEvent: 'Adds one event and returns it.',
            addPeriod: 'Adds one period and returns it.',
            clear: 'Clears events and periods.',
            undo: 'Restores the previous timeline state.',
            redo: 'Restores the next timeline state.',
            setZoom: 'Sets the editor zoom between 0.5 and 2.',
            setDateFormat: 'Sets date display to numeric or long French format.',
            getPrompt: 'Returns either the chatbot or autonomous-agent prompt for a topic.'
        },
        domFallback: {
            openAssistant: '[data-agent-action="open-ai-assistant"]',
            jsonInput: '#ai-json-input',
            importButton: '[data-agent-action="import-ai-json"]',
            timeline: '#timeline-space'
        },
        events: {
            stateChange: 'window event timeline:statechange'
        },
        schema
    };
}

window.timelineAgent = Object.freeze({
    version: '1.3',
    describe: () => getAgentDescriptor(),
    getState: () => JSON.parse(JSON.stringify(state)),
    importState: payload => applyTimelinePayload(payload, { adaptiveEventWidth: true }),
    addEvent: payload => {
        const event = normalizeEventInput(payload, state.events.length);
        state.events.push(event);
        renderTimeline();
        return JSON.parse(JSON.stringify(event));
    },
    addPeriod: payload => {
        const period = normalizePeriodInput(payload, state.periods.length);
        state.periods.push(period);
        renderTimeline();
        return JSON.parse(JSON.stringify(period));
    },
    clear: () => {
        state.events = [];
        state.periods = [];
        editingEventId = null;
        editingPeriodId = null;
        renderTimeline();
        return window.timelineAgent.getState();
    },
    undo: () => {
        undoTimeline();
        return window.timelineAgent.getState();
    },
    redo: () => {
        redoTimeline();
        return window.timelineAgent.getState();
    },
    setZoom: value => setTimelineZoom(value),
    setDateFormat: format => setDateFormat(format),
    getPrompt: (topic, options = {}) => buildAiPrompt(topic, options)
});
document.documentElement.dataset.timelineAgentApi = window.timelineAgent.version;

restoreDraft();
restoreTimelineZoom();
syncSettingsControls();
updateAiPrompt();
setEditorTab('event');
setMobileView('canvas');
renderTimeline();
if (state.events.length || state.periods.length) focusTimelineContent();
