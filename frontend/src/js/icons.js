// Lucide icons at one size and stroke (set by the .icon class in base.css).
// Markup uses <i data-icon="name"></i>, replaced by hydrateIcons(); code that
// builds HTML strings uses iconSvg(name).
import {
    AppWindow, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, CircleCheck,
    Brush, CircleQuestionMark, CircleX, Download, Eye, EyeOff, FilePenLine, FileText, Folder, FolderOpen, Highlighter, History, Image, Info,
    Keyboard, KeyRound, Menu, Minus, MousePointer2, Palette, PanelLeft, Pencil, Plus, Redo2, RefreshCw, Save,
    SavePen, Settings, ShieldCheck, ShieldX, Signature, SlidersHorizontal, SquarePen, Trash2, TriangleAlert,
    Type, Undo2, X, Search,
    ArrowLeft, Copy, Cpu, FileKey, Globe, IdCard
} from 'lucide';
// Command palette, dialogs and the start page.
import {
    ArrowRightLeft, GalleryVerticalEnd, Hash, House, ListTree, Lock, Monitor, Moon, MoveHorizontal,
    Scan, Sun, ZoomIn, ZoomOut
} from 'lucide';
// Settings: restoring defaults.
import { RotateCcw } from 'lucide';
// A signature's certificate chain.
import { Shield, ShieldAlert } from 'lucide';

const ICONS = {
    'app-window': AppWindow,
    'arrow-left': ArrowLeft,
    brush: Brush,
    'chevron-down': ChevronDown,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    'chevron-up': ChevronUp,
    'circle-alert': CircleAlert,
    'circle-check': CircleCheck,
    'circle-question': CircleQuestionMark,
    'circle-x': CircleX,
    copy: Copy,
    cpu: Cpu,
    download: Download,
    eye: Eye,
    'eye-off': EyeOff,
    'file-key': FileKey,
    'file-pen-line': FilePenLine,
    'file-text': FileText,
    folder: Folder,
    'folder-open': FolderOpen,
    globe: Globe,
    highlighter: Highlighter,
    history: History,
    'id-card': IdCard,
    image: Image,
    info: Info,
    keyboard: Keyboard,
    'key-round': KeyRound,
    menu: Menu,
    minus: Minus,
    pointer: MousePointer2,
    palette: Palette,
    'panel-left': PanelLeft,
    pencil: Pencil,
    plus: Plus,
    redo: Redo2,
    refresh: RefreshCw,
    save: Save,
    'save-as': SavePen,
    search: Search,
    settings: Settings,
    'shield-check': ShieldCheck,
    'shield-x': ShieldX,
    signature: Signature,
    sliders: SlidersHorizontal,
    'square-pen': SquarePen,
    trash: Trash2,
    'triangle-alert': TriangleAlert,
    type: Type,
    undo: Undo2,
    x: X,
    // Command palette, dialogs and the start page.
    'arrow-right-left': ArrowRightLeft,
    'gallery-vertical-end': GalleryVerticalEnd,
    hash: Hash,
    house: House,
    'list-tree': ListTree,
    lock: Lock,
    monitor: Monitor,
    moon: Moon,
    'move-horizontal': MoveHorizontal,
    scan: Scan,
    sun: Sun,
    'zoom-in': ZoomIn,
    'zoom-out': ZoomOut,
    'rotate-ccw': RotateCcw,
    // A signature's certificate chain.
    shield: Shield,
    'shield-alert': ShieldAlert
};

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const nodeToSvg = ([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}/>`;

/** SVG markup for a named icon. extraClass adds classes such as "icon-sm". */
export function iconSvg(name, extraClass = '') {
    const node = ICONS[name];
    if (!node) throw new Error(`unknown icon "${name}"`);
    const cls = extraClass ? `icon ${extraClass}` : 'icon';
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${node.map(nodeToSvg).join('')}</svg>`;
}

/** Replaces every <i data-icon="name"> under root with its SVG. */
export function hydrateIcons(root = document) {
    for (const el of root.querySelectorAll('i[data-icon]')) {
        el.outerHTML = iconSvg(el.dataset.icon, el.className);
    }
}
