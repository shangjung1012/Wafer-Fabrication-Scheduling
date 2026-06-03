#!/usr/bin/env python3
"""Chen-notation ER diagram  –  1024×512 landscape, text always on top."""
import math

W, H = 2048, 1024

# ── Style ─────────────────────────────────────────────────────────────────────
ENTITY_FILL  = "#5b8dee"; ENTITY_STR = "#3a6fd8"; ENTITY_TXT = "white"
REL_FILL     = "#1e293b"; REL_TXT    = "white"
ATTR_FILL    = "#6ee7a0"; ATTR_STR   = "#34c973"; ATTR_TXT   = "#0d2010"
LINE_COL     = "black"
CARD_COL     = "#dc2626"
FONT         = "Arial, Helvetica, sans-serif"

# ── Sizes ─────────────────────────────────────────────────────────────────────
EW, EH        = 158, 40      # entity box  (wider to fit long names)
DW, DH        = 74,  40      # diamond
ARX, ARY      = 30,  15     # attribute ellipse radii
ADIST         = 120          # entity-centre → attribute-centre

# ── Primitives ────────────────────────────────────────────────────────────────
def seg(x1,y1,x2,y2):
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}"'
            f' stroke="{LINE_COL}" stroke-width="0.5"/>')

def box(cx,cy,w,h,fill,stroke,rx=5):
    return (f'<rect x="{cx-w/2:.1f}" y="{cy-h/2:.1f}" width="{w}" height="{h}"'
            f' fill="{fill}" stroke="{stroke}" stroke-width="0.5" rx="{rx}"/>')

def diamond(cx,cy,w,h,fill):
    p=(f"{cx:.1f},{cy-h/2:.1f} {cx+w/2:.1f},{cy:.1f}"
       f" {cx:.1f},{cy+h/2:.1f} {cx-w/2:.1f},{cy:.1f}")
    return f'<polygon points="{p}" fill="{fill}" stroke="#475569" stroke-width="0.5"/>'

def ellipse(cx,cy,rx,ry,fill,stroke):
    return (f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{rx}" ry="{ry}"'
            f' fill="{fill}" stroke="{stroke}" stroke-width="0.5"/>')

def txt(x, y, s, size=12, color="black", bold=False, ul=False, anchor="middle"):
    fw = "bold" if bold else "normal"
    td = " text-decoration='underline'" if ul else ""
    halo = (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}"'
            f' fill="white" text-anchor="{anchor}" dominant-baseline="central"'
            f' font-weight="{fw}" stroke="white" stroke-width="0.5"'
            f' stroke-linejoin="round" paint-order="stroke">{s}</text>')
    main = (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}"'
            f' fill="{color}" text-anchor="{anchor}" dominant-baseline="central"'
            f' font-weight="{fw}"{td}>{s}</text>')
    return halo + "\n" + main

def axy(ecx, ecy, deg):
    """Attribute position: 0=E  90=N(up)  180=W  270=S(down)"""
    r = math.radians(deg)
    return ecx + ADIST*math.cos(r), ecy - ADIST*math.sin(r)

# ── Layout  (landscape 2048×1024, 3 vertical zones) ──────────────────────────
#
#   Zone 1 — Auth      x ≈  30–530
#     EmailChangeToken offset right (400), RT/User/UserInv stacked at x=200
#   Zone 2 — Production x ≈ 560–1100  (2×2 grid)
#   Zone 3 — Issues    x ≈1120–1900   (CI centre, CIC/CIE spread)
#
#   Config strip at y≈920, well clear of production attrs.

E = {
    # Zone 1 — Auth
    "EmailChangeToken":     (400, 200),   # ← NEW
    "RefreshToken":         (200, 315),
    "User":                 (200, 495),
    "UserInvitation":       (200, 675),
    # Zone 2 — Production
    "Factory":              (680, 245),
    "DailyCapacity":        (960, 195),
    "Order":                (680, 645),
    "OrderAssignment":      (960, 705),
    # Zone 3 — Issues
    "ConflictIssue":        (1320, 475),
    "ConflictIssueComment": (1660, 290),
    "ConflictIssueEvent":   (1660, 680),
    # Config (bottom strip)
    "SystemState":          (490, 930),
    "AutoSchedulerConfig":  (1160, 930),
}

# ── Attributes  (label, angle°, is_pk) ───────────────────────────────────────
# Angle convention: 0=E  90=N(screen-up)  180=W  270=S(screen-down)
A = {
    "EmailChangeToken": [         # ← NEW entity
        # User is SW → attrs go N / NE / E
        ("id",        90, True),
        ("newEmail",  40, False),
        ("expiresAt",  0, False),
    ],
    "RefreshToken": [
        # Replaces diamond is upper-left, User is below → attrs go NE / E
        ("id",         90, True),
        ("tokenHash",  40, False),
        ("expiresAt",  10, False),
    ],
    "User": [
        ("id",        180, True),
        ("username",  155, False),
        ("role",      205, False),
    ],
    "UserInvitation": [
        ("id",        270, True),
        ("tokenHash", 225, False),
        ("expiresAt", 315, False),
    ],
    "Factory": [
        ("id",              90, True),
        ("productionType", 130, False),
        ("status",         160, False),
        ("maxCapacity",    200, False),
    ],
    "DailyCapacity": [
        ("id",           90, True),
        ("date",         40, False),
        ("maxCapacity",   5, False),
        ("curCapacity",  330, False),
    ],
    "Order": [
        ("id",         225, True),
        ("status",     195, False),
        ("dueDate",    255, False),
        ("quantity",   275, False),
        ("type",       305, False),
    ],
    "OrderAssignment": [
        ("id",              20, True),
        ("status",         345, False),
        ("productionDate", 315, False),
        ("assignedQty",    280, False),
    ],
    "ConflictIssue": [
        ("id",         100, True),
        ("number",     128, False),
        ("status",     155, False),
        ("resolution", 180, False),
        ("title",       72, False),
    ],
    "ConflictIssueComment": [
        ("id",        90, True),
        ("body",      45, False),
        ("proposal",   5, False),
    ],
    "ConflictIssueEvent": [
        ("id",       270, True),
        ("type",     315, False),
        ("payload",    5, False),
    ],
    "SystemState": [
        ("id",               90, True),
        ("isSimulationMode", 140, False),
        ("simulationDate",    40, False),
    ],
    "AutoSchedulerConfig": [
        ("id",               90, True),
        ("type",             45, False),
        ("reschedulePolicy", 135, False),
        ("algorithm",        165, False),
        ("splittable",        15, False),
    ],
}

# ── Relationships ─────────────────────────────────────────────────────────────
def mid(e1, e2, t=.5):
    x = E[e1][0]*(1-t) + E[e2][0]*t
    y = E[e1][1]*(1-t) + E[e2][1]*t
    return round(x), round(y)

RELS = [
    # ── Zone 1: Auth ──────────────────────────────────────────────────────────
    ("Changes",  *mid("User","EmailChangeToken"),        [("User","1"),      ("EmailChangeToken","N")]),
    ("Owns",     *mid("User","RefreshToken"),            [("User","1"),      ("RefreshToken","N")]),
    ("Receives", *mid("User","UserInvitation"),          [("User","1"),      ("UserInvitation","N")]),
    # ── Zone 1 → 2: User ↔ Production ────────────────────────────────────────
    ("Admins",   *mid("User","Factory"),                 [("User","N"),      ("Factory","M")]),
    ("Creates",   385, 600,                              [("User","1"),      ("Order","N")]),   # applicant
    ("Modifies",  590, 625,                              [("User","1"),      ("Order","N")]),   # lastModifiedBy (opt)
    # ── Zone 2: Production internals ─────────────────────────────────────────
    ("Has",      *mid("Factory","DailyCapacity"),        [("Factory","1"),   ("DailyCapacity","N")]),
    ("Assigned", *mid("Factory","OrderAssignment"),      [("Factory","1"),   ("OrderAssignment","N")]),
    ("Has",      *mid("Order","OrderAssignment"),        [("Order","1"),     ("OrderAssignment","N")]),
    # ── Zone 2 → 3: toward Issues ────────────────────────────────────────────
    ("Raises",   *mid("Order","ConflictIssue", .62),     [("Order","N"),     ("ConflictIssue","1")]),
    ("Opens",     545, 460,                              [("User","1"),      ("ConflictIssue","N")]),  # createdBy
    ("Handles",   840, 465,                              [("User","N"),      ("ConflictIssue","1")]),  # assignee
    ("Authors",   400, 295,                              [("User","1"),      ("ConflictIssueComment","N")]),
    ("Acts",      660, 570,                              [("User","1"),      ("ConflictIssueEvent","N")]),
    # ── Zone 3: Issues internals ──────────────────────────────────────────────
    ("Has",      *mid("ConflictIssue","ConflictIssueComment"),
                                                         [("ConflictIssue","1"),("ConflictIssueComment","N")]),
    ("Logs",     *mid("ConflictIssue","ConflictIssueEvent"),
                                                         [("ConflictIssue","1"),("ConflictIssueEvent","N")]),
]

# ── Assemble — shapes first, then all text ────────────────────────────────────
shapes, labels = [], []

shapes.append(f'<rect width="{W}" height="{H}" fill="#f8fafc"/>')
labels.append(txt(W/2, 22, "Wafer Fabrication Scheduling — Entity Relationship Diagram",
                  size=15, color="#1e293b", bold=True))

# Zone separator lines (vertical, stop above config strip)
for zx in (530, 1110):
    shapes.append(f'<line x1="{zx}" y1="38" x2="{zx}" y2="830"'
                  f' stroke="#e2e8f0" stroke-width="1" stroke-dasharray="5 4"/>')

# Relationship connector lines
for _, rcx, rcy, conns in RELS:
    for ename, _ in conns:
        ex, ey = E[ename]
        shapes.append(seg(rcx, rcy, ex, ey))

# Attribute connector lines
for ename, (ex, ey) in E.items():
    for _, deg, _ in A.get(ename, []):
        ax, ay = axy(ex, ey, deg)
        shapes.append(seg(ex, ey, ax, ay))

# Relationship diamonds
for label, rcx, rcy, conns in RELS:
    shapes.append(diamond(rcx, rcy, DW, DH, REL_FILL))
    labels.append(txt(rcx, rcy, label, size=10, color=REL_TXT, bold=True))
    for ename, card in conns:
        ex, ey = E[ename]
        tx = rcx + (ex-rcx)*.30
        ty = rcy + (ey-rcy)*.30
        labels.append(txt(tx, ty, card, size=10, color=CARD_COL, bold=True))

# Entity boxes
for ename, (ex, ey) in E.items():
    shapes.append(box(ex, ey, EW, EH, ENTITY_FILL, ENTITY_STR))
    labels.append(txt(ex, ey, ename, size=11, color=ENTITY_TXT, bold=True))

# Attribute ellipses
for ename, (ex, ey) in E.items():
    for aname, deg, is_pk in A.get(ename, []):
        ax, ay = axy(ex, ey, deg)
        shapes.append(ellipse(ax, ay, ARX, ARY, ATTR_FILL, ATTR_STR))
        labels.append(txt(ax, ay, aname, size=9, color=ATTR_TXT, ul=is_pk))

# ── RefreshToken self-reference: Replaces (replacedByToken) ──────────────────
_rx, _ry = E["RefreshToken"]
_dcx, _dcy = _rx - 90, _ry - 95   # diamond above-left of RT
shapes.append(diamond(_dcx, _dcy, DW, DH, REL_FILL))
labels.append(txt(_dcx, _dcy, "Replaces", size=10, color=REL_TXT, bold=True))
shapes.append(seg(_dcx, _dcy, _rx - EW//4, _ry - EH//2))   # left leg → top-left of RT
shapes.append(seg(_dcx, _dcy, _rx + EW//4, _ry - EH//2))   # right leg → top-right of RT
labels.append(txt(_dcx + (_rx - EW//4 - _dcx)*.30,
                  _dcy + (_ry - EH//2 - _dcy)*.30, "1", size=10, color=CARD_COL, bold=True))
labels.append(txt(_dcx + (_rx + EW//4 - _dcx)*.30,
                  _dcy + (_ry - EH//2 - _dcy)*.30, "N", size=10, color=CARD_COL, bold=True))

# Legend (bottom-right)
lx, ly = W-390, H-48
shapes.append(box(lx+165, ly+10, 336, 38, "white", "#cbd5e1", rx=4))
shapes.append(box     (lx+28,  ly+10, 52, 24, ENTITY_FILL, ENTITY_STR, rx=3))
labels.append(txt     (lx+28,  ly+10, "Entity",    size=10, color="white"))
shapes.append(diamond (lx+110, ly+10, 46, 26, REL_FILL))
labels.append(txt     (lx+110, ly+10, "Relation",  size=10, color="white"))
shapes.append(ellipse (lx+196, ly+10, 36, 14, ATTR_FILL, ATTR_STR))
labels.append(txt     (lx+196, ly+10, "Attribute", size=10, color=ATTR_TXT))
labels.append(txt     (lx+270, ly+10, "Underlined=PK  Red=Card.", size=9, color="#64748b"))

# ── Output ────────────────────────────────────────────────────────────────────
body = "\n".join(shapes) + "\n" + "\n".join(labels)
svg  = (f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"'
        f' viewBox="0 0 {W} {H}">\n{body}\n</svg>')

out = "/Users/harryp/Desktop/Courses/Cloud Native/Wafer-Fabrication-Scheduling/prisma/ERD.svg"
with open(out, "w", encoding="utf-8") as f:
    f.write(svg)
print(f"Written → {out}  ({W}×{H})")
