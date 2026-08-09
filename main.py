#!/usr/bin/env python3
"""
UniViewer - CHUNITHM Data Browser
Native desktop application using pywebview + Python HTTP server
Version: 0.0.2.alpha.2
"""

import os
import sys
import json
import re
import threading
import subprocess
import zipfile
import urllib.parse
import http.server
import urllib.parse
import xml.etree.ElementTree as ET

# ============================================================
# Constants
# ============================================================
APP_NAME = "UniViewer"
APP_VERSION = "0.0.2.alpha.2"
DEFAULT_GAME_PATH = r"D:\SDHD_2.50"

# When running as a PyInstaller bundle, sys._MEIPASS points to the
# temporary directory where bundled read-only resources are extracted.
# When running as a normal script, fall back to the script's directory.
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    _BUNDLE_DIR = sys._MEIPASS          # read-only resources (public/)
    _EXE_DIR = os.path.dirname(sys.executable)  # writable dir (config, cache)
else:
    _BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
    _EXE_DIR = _BUNDLE_DIR

CONFIG_PATH = os.path.join(_EXE_DIR, "config.json")
# Compute PUBLIC_DIR lazily to handle frozen vs source correctly
def _compute_public_dir():
    """Find the public/ directory containing index.html."""
    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(sys.executable)
        candidates = [
            os.path.join(exe_dir, "_internal", "public"),
            os.path.join(exe_dir, "public"),
        ]
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(script_dir, "public"),
            os.path.join(script_dir, "_internal", "public"),
        ]
    for d in candidates:
        if os.path.isfile(os.path.join(d, "index.html")):
            return d
    return candidates[0]

_PUBLIC_DIR = None
def get_public_dir():
    global _PUBLIC_DIR
    if _PUBLIC_DIR is None:
        _PUBLIC_DIR = _compute_public_dir()
    return _PUBLIC_DIR
CACHE_DIR = os.path.join(_EXE_DIR, ".cache")
HOST = "127.0.0.1"
PORT = 17890

DIFF_NAMES = {1: "BASIC", 2: "ADVANCED", 3: "EXPERT", 4: "MASTER", 5: "ULTIMA"}
DIFF_TYPE_MAP = {"BASIC": 1, "ADVANCED": 2, "EXPERT": 3, "MASTER": 4, "ULTIMA": 5, "WORLD'S END": 6}

# Unified category registry — single source of truth for all data types.
# Each category defines how to load its data and what sub-types exist.
CATEGORY_REGISTRY = {
    "charts": {
        "dir": "music",
        "xml": "Music.xml",
    },
    "characters": {
        "dir": "chara",
        "xml": "Chara.xml",
    },
    "avatars": {
        "dir": "avatarAccessory",
        "xml": "AvatarAccessory.xml",
        "subs": {  # sub_key → directory prefix suffix
            "face":  "01", "head":  "02", "body":  "03",
            "item":  "04", "back":  "06", "front": "08",
        },
    },
    "collectibles": {
        # dir/xml vary per sub, stored in subs mapping
        "subs": {
            "trophy":      ("trophy",      "Trophy.xml"),
            "nameplate":   ("namePlate",   "NamePlate.xml"),
            "mapicon":     ("mapIcon",     "MapIcon.xml"),
            "systemvoice": ("systemVoice", "SystemVoice.xml"),
        },
    },
    "others": {
        "subs": {
            "map":    ("map",    "Map.xml"),
            "course": ("course", "Course.xml"),
            "quest":  ("quest",  "Quest.xml"),
            "ticket": ("ticket", "Ticket.xml"),
        },
    },
}
# Flatten all known directory names for source detection
_ALL_DATA_DIRS = set()
for _cat_cfg in CATEGORY_REGISTRY.values():
    if _cat_cfg.get("dir"):
        _ALL_DATA_DIRS.add(_cat_cfg["dir"])
    for _sub_data in _cat_cfg.get("subs", {}).values():
        _ALL_DATA_DIRS.add(_sub_data[0] if isinstance(_sub_data, tuple) else _sub_data)


# ============================================================
# Settings Management
# ============================================================
def load_settings():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"language": "zh-CN", "game_data_path": DEFAULT_GAME_PATH}


def save_settings(settings):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


# ============================================================
# XML Helpers
# ============================================================
def xstr(root, tag):
    """Extract text from <tag><str>text</str></tag>"""
    node = root.find(tag)
    if node is not None:
        s = node.find("str")
        if s is not None and s.text:
            return s.text.strip()
    return ""


def xval(root, tag):
    """Extract text content from <tag>text</tag>"""
    node = root.find(tag)
    if node is not None and node.text:
        return node.text.strip()
    return ""


def xtype(fumen, tag):
    """Extract type from <tag><data>BASIC</data></tag> structure"""
    node = fumen.find(tag)
    if node is not None:
        data = node.find("data")
        if data is not None and data.text:
            return data.text.strip()
    return ""


def set_xstr(root, tag, value):
    """Set text in <tag><str>value</str></tag>"""
    node = root.find(tag)
    if node is None:
        node = ET.SubElement(root, tag)
    s = node.find("str")
    if s is None:
        s = ET.SubElement(node, "str")
    s.text = value


def set_xval(root, tag, value):
    """Set text in <tag>value</tag>"""
    node = root.find(tag)
    if node is None:
        node = ET.SubElement(root, tag)
    node.text = value


# ============================================================
# Data Loader
# ============================================================
class DataLoader:
    def __init__(self, game_path):
        self.game_path = game_path
        self.cache = {}
        self._release_tag_map = None  # {tag_str: titleName} lazy-loaded from releaseTag XMLs

    def clear_cache(self):
        self.cache.clear()
        self._release_tag_map = None  # invalidate release tag map too

    def _build_release_tag_map(self):
        """Build {releaseTagName_str: titleName} from releaseTag XMLs."""
        result = {}
        for source_name, _ in self.get_sources():
            source_path = self.get_source_path(source_name)
            rt_dir = os.path.join(source_path, "releaseTag")
            if not os.path.isdir(rt_dir):
                continue
            for entry in sorted(os.listdir(rt_dir)):
                xml_path = os.path.join(rt_dir, entry, "ReleaseTag.xml")
                if not os.path.exists(xml_path):
                    continue
                try:
                    tree = ET.parse(xml_path)
                    root = tree.getroot()
                    name_node = root.find("name")
                    tag_str = ""
                    if name_node is not None:
                        s = name_node.find("str")
                        if s is not None and s.text:
                            tag_str = s.text.strip()
                    title_node = root.find("titleName")
                    title = ""
                    if title_node is not None and title_node.text:
                        title = title_node.text.strip()
                    if tag_str:
                        result[tag_str] = title
                except Exception:
                    pass
        self._release_tag_map = result

    def get_version_name(self, release_tag_str):
        """Look up the actual version name (titleName) for a releaseTagName string."""
        if not release_tag_str:
            return ""
        if self._release_tag_map is None:
            self._build_release_tag_map()
        return self._release_tag_map.get(release_tag_str, "")

    def get_sources(self):
        """Detect all data sources (A000, A001, etc.) with version info"""
        sources = []
        main_data = os.path.join(self.game_path, "data", "A000")
        if os.path.isdir(main_data):
            sources.append(("A000", self._read_conf_version(main_data)))
        option_dir = os.path.join(self.game_path, "bin", "option")
        if os.path.isdir(option_dir):
            for d in sorted(os.listdir(option_dir)):
                dpath = os.path.join(option_dir, d)
                if d.startswith("A") and os.path.isdir(dpath):
                    if any(os.path.isdir(os.path.join(dpath, sub)) for sub in _ALL_DATA_DIRS):
                        sources.append((d, self._read_conf_version(dpath)))
        return sources

    def _read_conf_version(self, dirpath):
        """Read version from data.conf in given directory"""
        conf_path = os.path.join(dirpath, "data.conf")
        if not os.path.exists(conf_path):
            return ""
        try:
            import configparser
            cfg = configparser.ConfigParser()
            cfg.read(conf_path, encoding="utf-8")
            if cfg.has_section("Version"):
                major = cfg.get("Version", "VerMajor", fallback="0")
                minor = cfg.get("Version", "VerMinor", fallback="0")
                release = cfg.get("Version", "VerRelease", fallback="0")
                ver_str = f"{major}.{minor}"
                if release != "0":
                    ver_str += f".{release}"
                # Format: "Ver.X.X" e.g. "Ver.2.50"
                return f"Ver.{ver_str}"
        except Exception:
            pass
        return ""

    def get_source_path(self, source):
        if source == "A000":
            return os.path.join(self.game_path, "data", "A000")
        return os.path.join(self.game_path, "bin", "option", source)

    def _load_from_dir(self, source, category, xml_file, parser, prefix=None):
        """Load items from a single source directory."""
        cache_key = f"{source}_{category}_{prefix or 'all'}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        source_path = self.get_source_path(source)
        cat_dir = os.path.join(source_path, category)
        items = []

        if not os.path.isdir(cat_dir):
            self.cache[cache_key] = items
            return items

        for entry in sorted(os.listdir(cat_dir)):
            if entry.endswith(".xml"):
                continue
            if prefix and not entry.startswith(prefix):
                continue

            item_dir = os.path.join(cat_dir, entry)
            if not os.path.isdir(item_dir):
                continue

            xml_path = os.path.join(item_dir, xml_file)
            if not os.path.exists(xml_path):
                continue

            try:
                tree = ET.parse(xml_path)
                root = tree.getroot()
                item = parser(root)
                if item:
                    item["id"] = entry
                    item["source"] = source
                    items.append(item)
            except Exception:
                pass

        self.cache[cache_key] = items
        return items

    def _load_merged(self, category, xml_file, parser, prefix=None):
        """Load items from all sources and merge into one list."""
        cache_key = f"merged_{category}_{prefix or 'all'}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        all_items = []
        for source_id, _ver in self.get_sources():
            items = self._load_from_dir(source_id, category, xml_file, parser, prefix)
            all_items.extend(items)

        self.cache[cache_key] = all_items
        return all_items

    def get_jacket_path(self, source, music_id):
        """Locate the DDS jacket file for a music entry.
        Reads the jaketFile path from Music.xml and resolves it relative
        to the music's data directory."""
        source_path = self.get_source_path(source)
        music_dir = os.path.join(source_path, "music", music_id)
        xml_path = os.path.join(music_dir, "Music.xml")
        if not os.path.exists(xml_path):
            return ""
        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()
            jaket = root.find("jaketFile")
            if jaket is None:
                return ""
            p = jaket.find("path")
            if p is None or not p.text:
                return ""
            rel = p.text.strip().replace("\\", "/")
            # If the path is absolute (e.g. starts with D:/), use as-is
            if os.path.isabs(rel):
                return rel
            # Else resolve relative to the music directory
            return os.path.normpath(os.path.join(music_dir, rel))
        except Exception:
            return ""

    def get_character_image_path(self, source, image_id, sub_idx="00"):
        """Resolve a character image ID (e.g. chara0000_00) to a DDS file path.
        
        image_id format: chara{idx:04d}_{variant:02d}
        sub_idx: 00 (large/detail), 02 (thumbnail/preview)
        """
        if not image_id or not image_id.startswith("chara"):
            return ""
        m = re.match(r"chara(\d{4})_(\d{2})", image_id)
        if not m:
            return ""
        idx = int(m.group(1))
        variant = int(m.group(2))
        folder_id = f"{idx * 10 + variant:06d}"
        dds_name = f"CHU_UI_Character_{idx:04d}_{variant:02d}_{sub_idx}.dds"
        source_path = self.get_source_path(source)
        dds_path = os.path.join(source_path, "ddsImage", f"ddsImage{folder_id}", dds_name)
        if os.path.exists(dds_path):
            return dds_path
        return ""

    # --- Charts (Music) ---
    def get_charts(self, source):
        def parser(root):
            notes = []
            fumens = root.find("fumens")
            if fumens is not None:
                for f in fumens.findall("MusicFumenData"):
                    type_name = xtype(f, "type")
                    type_id = DIFF_TYPE_MAP.get(type_name, 0)
                    # Extract file path from <file><path>...</path></file>
                    file_path = ""
                    file_node = f.find("file")
                    if file_node is not None:
                        p = file_node.find("path")
                        if p is not None and p.text:
                            file_path = p.text.strip()
                    # notesDesigner: <notesDesigner>text</notesDesigner> or empty self-closing
                    charter = ""
                    nd_node = f.find("notesDesigner")
                    if nd_node is not None and nd_node.text:
                        charter = nd_node.text.strip()
                    notes.append({
                        "type": type_id,
                        "typeName": type_name or "?",
                        "level": int(xval(f, "level") or "0"),
                        "levelDecimal": int(xval(f, "levelDecimal") or "0"),
                        "enable": xval(f, "enable").lower() == "true",
                        "charter": charter,
                        "file": file_path,
                        "defaultBpm": int(xval(f, "defaultBpm") or "0"),
                    })
            notes.sort(key=lambda n: n["type"])
            # Extract genre from genreNames > list > StringID > str
            genre = ""
            genre_node = root.find("genreNames")
            if genre_node is not None:
                sid = genre_node.find(".//StringID/str")
                if sid is not None and sid.text:
                    genre = sid.text.strip()
            # Extract jacket file path
            jacket = ""
            jaket_node = root.find("jaketFile")
            if jaket_node is not None:
                p = jaket_node.find("path")
                if p is not None and p.text:
                    jacket = p.text.strip()
            # releaseDate as formatted string
            raw_date = xval(root, "releaseDate")
            release_date = ""
            if raw_date and len(raw_date) == 8:
                release_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
            elif raw_date:
                release_date = raw_date
            return {
                "name": xstr(root, "name"),
                "sortName": xval(root, "sortName"),
                "artist": xstr(root, "artistName"),
                "genre": genre,
                "worksName": xstr(root, "worksName"),
                "labelName": xstr(root, "labelName"),
                "releaseTagName": xstr(root, "releaseTagName"),
                "versionName": self.get_version_name(xstr(root, "releaseTagName")),
                "releaseDate": release_date,
                "jaketFile": jacket,
                "cueFileName": xstr(root, "cueFileName"),
                "stageName": xstr(root, "stageName"),
                "worldsEndTagName": xstr(root, "worldsEndTagName"),
                "firstLock": xval(root, "firstLock").lower() == "true",
                "enableUltima": xval(root, "enableUltima").lower() == "true",
                "isGiftMusic": xval(root, "isGiftMusic").lower() == "true",
                "disableFlag": xval(root, "disableFlag").lower() == "true",
                "exType": int(xval(root, "exType") or "0"),
                "starDifType": int(xval(root, "starDifType") or "0"),
                "priority": int(xval(root, "priority") or "0"),
                "notes": notes,
            }
        return self._load_from_dir(source, "music", "Music.xml", parser)

    def get_options(self):
        """Return available genres and release tags for dropdowns"""
        # Genres: scan all Music.xml files for unique genre values
        genres = set()
        for source_id, _ver in self.get_sources():
            source_path = self.get_source_path(source_id)
            music_dir = os.path.join(source_path, "music")
            if not os.path.isdir(music_dir):
                continue
            for entry in os.listdir(music_dir):
                xml_path = os.path.join(music_dir, entry, "Music.xml")
                if not os.path.exists(xml_path):
                    continue
                try:
                    tree = ET.parse(xml_path)
                    root = tree.getroot()
                    gn = root.find("genreNames")
                    if gn is not None:
                        sid = gn.find(".//StringID/str")
                        if sid is not None and sid.text:
                            genres.add(sid.text.strip())
                except Exception:
                    pass

        # Release tags: read from releaseTag directory
        release_tags = []
        rt_dir = os.path.join(self.get_source_path("A000"), "releaseTag")
        if os.path.isdir(rt_dir):
            for entry in sorted(os.listdir(rt_dir)):
                xml_path = os.path.join(rt_dir, entry, "ReleaseTag.xml")
                if not os.path.exists(xml_path):
                    continue
                try:
                    tree = ET.parse(xml_path)
                    root = tree.getroot()
                    rid = root.find(".//id")
                    rstr = root.find(".//str")
                    tag_str = rstr.text.strip() if rstr is not None and rstr.text else ""
                    tag_id = int(rid.text) if rid is not None and rid.text else 0
                    # Read titleName directly from ReleaseTag.xml
                    title_node = root.find("titleName")
                    vname = title_node.text.strip() if title_node is not None and title_node.text else ""
                    release_tags.append({
                        "id": tag_id,
                        "str": tag_str,
                        "versionName": vname,
                    })
                except Exception:
                    pass

        return {
            "genres": sorted(genres),
            "releaseTags": release_tags,
        }

    def save_chart(self, source, music_id, fields):
        """Save chart data back to Music.xml"""
        source_path = self.get_source_path(source)
        music_dir = os.path.join(source_path, "music", music_id)
        xml_path = os.path.join(music_dir, "Music.xml")
        if not os.path.exists(xml_path):
            return {"error": "Music.xml not found"}

        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()

            # Save top-level fields
            if "name" in fields:
                set_xstr(root, "name", fields["name"])
            if "sortName" in fields:
                set_xval(root, "sortName", fields["sortName"])
            if "artist" in fields:
                set_xstr(root, "artistName", fields["artist"])
            if "genre" in fields:
                genre_node = root.find("genreNames")
                if genre_node is not None:
                    str_node = genre_node.find(".//StringID/str")
                    if str_node is not None:
                        str_node.text = fields["genre"]
            if "releaseDate" in fields:
                date_str = fields["releaseDate"].replace("-", "")
                set_xval(root, "releaseDate", date_str)
            if "releaseTagName" in fields:
                rt_node = root.find("releaseTagName")
                if rt_node is not None:
                    tag_str = fields["releaseTagName"]
                    s = rt_node.find("str")
                    if s is None:
                        s = ET.SubElement(rt_node, "str")
                    s.text = tag_str
                    # Also update id based on release tag lookup
                    opts = self.get_options()
                    for rt in opts["releaseTags"]:
                        if rt["str"] == tag_str:
                            id_node = rt_node.find("id")
                            if id_node is None:
                                id_node = ET.SubElement(rt_node, "id")
                            id_node.text = str(rt["id"])
                            break

            # Save notes (difficulty) data
            if "notes" in fields:
                fumens = root.find("fumens")
                if fumens is not None:
                    for f in fumens.findall("MusicFumenData"):
                        type_name = xtype(f, "type")
                        type_id = DIFF_TYPE_MAP.get(type_name, 0)
                        for note_data in fields["notes"]:
                            if note_data.get("type") == type_id:
                                set_xval(f, "level", str(note_data.get("level", 0)))
                                set_xval(f, "levelDecimal", str(note_data.get("levelDecimal", 0)))
                                set_xval(f, "enable", "true" if note_data.get("enable") else "false")
                                break

            tree.write(xml_path, encoding="utf-8", xml_declaration=True)
            self.clear_cache()
            return {"status": "ok"}
        except Exception as e:
            return {"error": str(e)}

    # --- Character Save ---
    def save_character(self, source, chara_id, fields):
        """Save character data back to Chara.xml"""
        source_path = self.get_source_path(source)
        chara_dir = os.path.join(source_path, "chara", chara_id)
        xml_path = os.path.join(chara_dir, "Chara.xml")
        if not os.path.exists(xml_path):
            return {"error": "Chara.xml not found"}

        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()

            if "name" in fields:
                set_xstr(root, "name", fields["name"])
            if "sortName" in fields:
                set_xval(root, "sortName", fields["sortName"])
            if "illustratorName" in fields:
                set_xstr(root, "illustratorName", fields["illustratorName"])
            if "worksName" in fields:
                set_xstr(root, "works", fields["worksName"])
            if "releaseTagName" in fields:
                rt_node = root.find("releaseTagName")
                if rt_node is not None:
                    s = rt_node.find("str")
                    if s is None:
                        s = ET.SubElement(rt_node, "str")
                    s.text = fields["releaseTagName"]

            tree.write(xml_path, encoding="utf-8", xml_declaration=True)
            self.clear_cache()
            return {"status": "ok"}
        except Exception as e:
            return {"error": str(e)}

    # --- Unified data loader for non-charts categories ---
    def get_data(self, category, sub=None):
        """Unified data loader — dispatches by category config."""
        cfg = CATEGORY_REGISTRY.get(category)
        if not cfg:
            return []

        # --- Avatars: sub maps to directory prefix ---
        if category == "avatars":
            prefix = None
            actual_sub = "all"
            if sub and sub in cfg.get("subs", {}):
                prefix = f"{cfg['dir']}{cfg['subs'][sub]}"
                actual_sub = sub
            def parser(root):
                return {
                    "name": xstr(root, "name"),
                    "type": xstr(root, "category") or "all",
                    "sub": actual_sub,
                }
            return self._load_merged(cfg["dir"], cfg["xml"], parser, prefix=prefix)

        # --- Collectibles / Others: sub selects dir+xml pair ---
        if "subs" in cfg and sub and sub in cfg["subs"]:
            dir_name, xml_file = cfg["subs"][sub]
            def parser(root):
                return {
                    "name": xstr(root, "name"),
                    "rareType": xval(root, "rareType"),
                    "sub": sub,
                }
            return self._load_merged(dir_name, xml_file, parser)

        # --- Characters: simple merged load with fixed parser ---
        if category == "characters":
            def parser(root):
                return {
                    "name": xstr(root, "name"),
                    "sortName": xval(root, "sortName"),
                    "worksName": xstr(root, "works"),
                    "illustratorName": xstr(root, "illustratorName"),
                    "releaseTagName": xstr(root, "releaseTagName"),
                    "rareType": xval(root, "rareType"),
                    "defaultImages": xstr(root, "defaultImages"),
                    "sub": "character",
                }
            return self._load_merged(cfg["dir"], cfg["xml"], parser)

        # --- Generic fallback for simple categories ---
        if cfg.get("dir") and cfg.get("xml"):
            def parser(root):
                return {
                    "name": xstr(root, "name"),
                    "rareType": xval(root, "rareType"),
                }
            return self._load_merged(cfg["dir"], cfg["xml"], parser)

        return []

    # --- Music File Operations ---
    def open_music_xml(self, source, music_id):
        source_path = self.get_source_path(source)
        music_dir = os.path.join(source_path, "music", music_id)
        xml_path = os.path.join(music_dir, "Music.xml")
        if not os.path.exists(xml_path):
            return {"error": "Music.xml not found: " + xml_path}
        try:
            subprocess.Popen(['start', '', xml_path], shell=True)
            return {"status": "ok", "path": xml_path}
        except Exception as e:
            try:
                os.startfile(xml_path)
                return {"status": "ok", "path": xml_path}
            except Exception as e2:
                return {"error": str(e2)}

    def open_music_folder(self, source, music_id):
        source_path = self.get_source_path(source)
        music_dir = os.path.join(source_path, "music", music_id)
        if not os.path.exists(music_dir):
            return {"error": "Folder not found: " + music_dir}
        try:
            subprocess.Popen(['explorer', music_dir])
            return {"status": "ok", "path": music_dir}
        except Exception as e:
            try:
                os.startfile(music_dir)
                return {"status": "ok", "path": music_dir}
            except Exception as e2:
                return {"error": str(e2)}

    def export_music_zip(self, source, music_id):
        source_path = self.get_source_path(source)
        m = re.match(r'music(\d+)', music_id)
        num_id = m.group(1) if m else music_id.lstrip('music')
        music_dir = os.path.join(source_path, "music", music_id)
        cue_dir = os.path.join(source_path, "cueFile", f"cueFile00{num_id}")
        if not os.path.exists(music_dir) and not os.path.exists(cue_dir):
            return {"error": "No data found for " + music_id}
        try:
            desktop = os.path.join(os.path.expanduser("~"), "Desktop")
            zip_path = os.path.join(desktop, f"{num_id}.zip")
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                if os.path.exists(cue_dir):
                    cue_prefix = f"{num_id}/cueFile/cueFile00{num_id}"
                    for root, dirs, files in os.walk(cue_dir):
                        for file in files:
                            zf.write(os.path.join(root, file), f"{cue_prefix}/{file}")
                if os.path.exists(music_dir):
                    music_prefix = f"{num_id}/music/{music_id}"
                    for root, dirs, files in os.walk(music_dir):
                        for file in files:
                            if file == "test_out.png":
                                continue
                            zf.write(os.path.join(root, file), f"{music_prefix}/{file}")
            return {"status": "ok", "path": zip_path}
        except Exception as e:
            return {"error": str(e)}

    # --- Game Version ---
    def get_game_version(self):
        """Read game version from data.conf (INI format with VerMajor/VerMinor/VerRelease)."""
        conf_path = os.path.join(self.game_path, "data", "A000", "data.conf")
        if os.path.exists(conf_path):
            try:
                with open(conf_path, "r", encoding="utf-8-sig") as f:
                    content = f.read()
                major = re.search(r"VerMajor\s*=\s*(\d+)", content)
                minor = re.search(r"VerMinor\s*=\s*(\d+)", content)
                release = re.search(r"VerRelease\s*=\s*(\d+)", content)
                if major and minor:
                    r = release.group(1).zfill(2) if release else "00"
                    return f"SDHD {major.group(1)}.{minor.group(1)}.{r}"
            except Exception:
                pass
        return "Unknown"


# ============================================================
# HTTP Handler
# ============================================================
class Handler(http.server.BaseHTTPRequestHandler):
    loader = None
    settings = None

    def log_message(self, fmt, *args):
        pass  # Suppress request logging

    def _send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, filepath, content_type):
        try:
            with open(filepath, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_error(404)

    def _paginate(self, items, qs):
        page = int(qs.get("page", ["1"])[0])
        limit = int(qs.get("limit", ["60"])[0])
        search = qs.get("search", [""])[0].lower()

        if search:
            filtered = []
            for item in items:
                name = (item.get("name") or "").lower()
                artist = (item.get("artist") or "").lower()
                works = (item.get("worksName") or "").lower()
                if search in name or search in artist or search in works:
                    filtered.append(item)
            items = filtered

        total = len(items)
        total_pages = max(1, (total + limit - 1) // limit) if limit > 0 else 1
        start = (page - 1) * limit
        end = start + limit
        page_items = items[start:end]

        self._send_json({
            "items": page_items,
            "count": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
        })

    def _full_settings(self):
        """Return settings with computed fields."""
        return {
            "language": self.settings.get("language", "zh-CN"),
            "game_data_path": self.settings.get("game_data_path", ""),
            "app_version": APP_VERSION,
            "game_version": self.loader.get_game_version(),
        }

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        # --- API routes ---
        if path == "/api/health":
            self._send_json({"status": "ok"})
            return

        if path == "/api/settings":
            self._send_json(self._full_settings())
            return

        if path == "/api/sources":
            sources = self.loader.get_sources()
            self._send_json([{"id": sid, "version": ver} for sid, ver in sources])
            return

        if path == "/api/options":
            self._send_json(self.loader.get_options())
            return

        if path == "/api/game-version":
            self._send_json({"version": self.loader.get_game_version()})
            return

        if path == "/api/data/charts":
            sub = qs.get("sub", [None])[0]
            if not sub:
                self._send_json({"items": [], "count": 0, "page": 1, "limit": 60, "total_pages": 1})
                return
            items = self.loader.get_charts(sub)
            self._paginate(items, qs)
            return

        # Generic data endpoint: /api/data/{category} → CATEGORY_REGISTRY categories
        if path.startswith("/api/data/") and path != "/api/data/charts":
            category = path.split("/")[3]
            if category not in CATEGORY_REGISTRY:
                self.send_error(404)
                return
            sub = qs.get("sub", [None])[0]
            if sub == "null" or sub == "":
                sub = None
            if not sub and "subs" in CATEGORY_REGISTRY[category]:
                sub = next(iter(CATEGORY_REGISTRY[category]["subs"]))
            items = self.loader.get_data(category, sub)
            self._paginate(items, qs)
            return

        # --- Cover image (DDS -> PNG) ---
        if path.startswith("/api/cover/"):
            # /api/cover/<source>/<music_id>
            parts = path.split("/")
            if len(parts) >= 4:
                source = parts[3]
                music_id = parts[4] if len(parts) >= 5 else ""
                dds_path = self.loader.get_jacket_path(source, music_id)
                if not dds_path or not os.path.exists(dds_path):
                    self.send_error(404)
                    return
                # Check cache
                try:
                    mtime = os.path.getmtime(dds_path)
                except OSError:
                    self.send_error(404)
                    return
                cache_key = f"cover_{dds_path}_{mtime}"
                cache_dir = os.path.join(CACHE_DIR, "covers")
                cache_png = os.path.join(cache_dir, source, music_id + ".png")
                if not os.path.exists(cache_png) or os.path.getmtime(cache_png) < mtime:
                    try:
                        from PIL import Image
                        os.makedirs(os.path.dirname(cache_png), exist_ok=True)
                        img = Image.open(dds_path)
                        # Resize to small thumbnail for fast loading (256px)
                        img.thumbnail((256, 256))
                        img.save(cache_png, "PNG")
                    except Exception as e:
                        self.send_error(500, str(e).encode())
                        return
                self._send_file(cache_png, "image/png")
                return
            self.send_error(400)
            return

        # --- Character image (DDS -> PNG) ---
        if path.startswith("/api/chara_img/"):
            # /api/chara_img/<source>/<image_id>/<sub>
            parts = path.split("/")
            if len(parts) >= 5:
                source = parts[3]
                image_id = parts[4] if len(parts) >= 5 else ""
                sub_idx = parts[5] if len(parts) >= 6 else "00"
                dds_path = self.loader.get_character_image_path(source, image_id, sub_idx)
                if not dds_path or not os.path.exists(dds_path):
                    self.send_error(404)
                    return
                try:
                    mtime = os.path.getmtime(dds_path)
                except OSError:
                    self.send_error(404)
                    return
                cache_dir = os.path.join(CACHE_DIR, "chara_images")
                cache_png = os.path.join(cache_dir, f"{source}_{image_id}_{sub_idx}.png")
                if not os.path.exists(cache_png) or os.path.getmtime(cache_png) < mtime:
                    try:
                        from PIL import Image
                        os.makedirs(os.path.dirname(cache_png), exist_ok=True)
                        img = Image.open(dds_path)
                        # Resize detail view to 512px, thumbnail to 256px
                        max_size = 512 if sub_idx == "00" else 256
                        img.thumbnail((max_size, max_size))
                        img.save(cache_png, "PNG")
                    except Exception as e:
                        self.send_error(500, str(e).encode())
                        return
                self._send_file(cache_png, "image/png")
                return
            self.send_error(400)
            return

        # --- Static files ---
        if path == "/" or path == "/index.html":
            self._send_file(os.path.join(get_public_dir(), "index.html"), "text/html; charset=utf-8")
            return

        if path == "/style.css":
            self._send_file(os.path.join(get_public_dir(), "style.css"), "text/css; charset=utf-8")
            return

        if path == "/app.js":
            self._send_file(os.path.join(get_public_dir(), "app.js"), "application/javascript; charset=utf-8")
            return

        # --- Music file operations ---
        if path == "/api/music/open-xml":
            src = qs.get("source", [""])[0]
            mid = qs.get("music_id", [""])[0]
            if src and mid:
                result = self.loader.open_music_xml(src, mid)
                self._send_json(result, 200 if "status" in result else 400)
                return
            self._send_json({"error": "Missing source or music_id"}, 400)
            return
        if path == "/api/music/open-folder":
            src = qs.get("source", [""])[0]
            mid = qs.get("music_id", [""])[0]
            if src and mid:
                result = self.loader.open_music_folder(src, mid)
                self._send_json(result, 200 if "status" in result else 400)
                return
            self._send_json({"error": "Missing source or music_id"}, 400)
            return
        if path == "/api/music/export-zip":
            src = qs.get("source", [""])[0]
            mid = qs.get("music_id", [""])[0]
            if src and mid:
                result = self.loader.export_music_zip(src, mid)
                self._send_json(result, 200 if "status" in result else 400)
                return
            self._send_json({"error": "Missing source or music_id"}, 400)
            return

        # Fallback: serve index.html for any unmatched GET (SPA routing)
        self._send_file(os.path.join(get_public_dir(), "index.html"), "text/html; charset=utf-8")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/settings":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                new_settings = json.loads(body)
                self.settings["language"] = new_settings.get("language", self.settings.get("language", "zh-CN"))
                self.settings["game_data_path"] = new_settings.get("game_data_path", self.settings.get("game_data_path", ""))
                save_settings(self.settings)
                # Recreate loader with new path
                Handler.loader = DataLoader(self.settings["game_data_path"])
                self._send_json(self._full_settings())
            except Exception as e:
                self._send_json({"error": str(e)}, 400)
            return

        if path == "/api/refresh":
            self.loader.clear_cache()
            self._send_json({"status": "ok"})
            return

        if path == "/api/save/chart":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
                source = data.get("source", "")
                music_id = data.get("music_id", "")
                fields = data.get("fields", {})
                result = self.loader.save_chart(source, music_id, fields)
                code = 200 if "status" in result else 400
                self._send_json(result, code)
            except Exception as e:
                self._send_json({"error": str(e)}, 400)
            return

        if path == "/api/save/character":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
                source = data.get("source", "")
                chara_id = data.get("chara_id", "")
                fields = data.get("fields", {})
                result = self.loader.save_character(source, chara_id, fields)
                code = 200 if "status" in result else 400
                self._send_json(result, code)
            except Exception as e:
                self._send_json({"error": str(e)}, 400)
            return

        self.send_error(404)


# ============================================================
# Main Entry Point
# ============================================================
def main():
    settings = load_settings()
    loader = DataLoader(settings.get("game_data_path", DEFAULT_GAME_PATH))

    Handler.settings = settings
    Handler.loader = loader

    # Start HTTP server in background thread
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    url = f"http://{HOST}:{PORT}"
    print(f"[UniViewer] Server running at {url}")

    # Try pywebview for native window
    try:
        import webview

        def on_loaded():
            print("[UniViewer] Window ready")

        class Api:
            """Bridge API exposed to the webview frontend (window.pywebview.api)."""
            def select_directory(self):
                """Open a native folder-picker dialog.
                Returns {"path": str, "error": str}.
                Validates that the folder (or its bin/ subfolder) contains
                amdaemon.exe and chusanApp.exe.
                """
                try:
                    result = window.create_file_dialog(
                        webview.FileDialog.FOLDER,
                        directory=settings.get("game_data_path") or DEFAULT_GAME_PATH,
                    )
                    if not result or len(result) == 0:
                        return {"path": "", "error": ""}
                    picked = result[0]
                    # Normalize path separators
                    picked = os.path.normpath(picked)
                    # Validate: check root and bin/ subfolder for required executables
                    required = ["amdaemon.exe", "chusanApp.exe"]
                    found = False
                    check_dirs = [picked, os.path.join(picked, "bin")]
                    for d in check_dirs:
                        if all(os.path.isfile(os.path.join(d, f)) for f in required):
                            found = True
                            break
                    if not found:
                        return {
                            "path": "",
                            "error": "所选目录中未找到 amdaemon.exe 和 chusanApp.exe，请选择游戏根目录（包含 bin 子目录）",
                        }
                    return {"path": picked, "error": ""}
                except Exception as e:
                    print(f"[UniViewer] select_directory error: {e}")
                    return {"path": "", "error": str(e)}

        api = Api()

        window = webview.create_window(
            f"{APP_NAME} v{APP_VERSION}",
            url,
            width=1200,
            height=800,
            min_size=(900, 600),
            text_select=False,
            js_api=api,
        )
        webview.start(func=on_loaded)
        # When the window closes, exit
        server.shutdown()
        sys.exit(0)

    except ImportError:
        print("[UniViewer] pywebview not installed, opening in browser...")
        import webbrowser
        webbrowser.open(url)
        # Keep server running
        try:
            server_thread.join()
        except KeyboardInterrupt:
            server.shutdown()

    except Exception as e:
        print(f"[UniViewer] pywebview error: {e}")
        print("[UniViewer] Falling back to browser...")
        import webbrowser
        webbrowser.open(url)
        try:
            server_thread.join()
        except KeyboardInterrupt:
            server.shutdown()


if __name__ == "__main__":
    main()
