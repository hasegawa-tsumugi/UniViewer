"""
UniViewer PyInstaller build script
Run: python build.py
Output: dist/UniViewer/UniViewer.exe (directory mode, includes WebView2 runtime)
"""
import PyInstaller.__main__ as pi
import os
import shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Clean previous build
for d in ["build", "dist"]:
    p = os.path.join(SCRIPT_DIR, d)
    if os.path.exists(p):
        shutil.rmtree(p)
        print(f"Cleaned {d}/")

pi.run([
    "main.py",
    "--name=UniViewer",
    "--noconfirm",
    "--clean",
    # Directory mode (folder) - faster startup, easier debugging
    "--onedir",
    # Don't show console window
    "--windowed",
    # Icon (optional, add if you have one)
    # "--icon=icon.ico",
    # Bundle static files
    "--add-data", os.path.join("public", "index.html") + os.pathsep + "public",
    "--add-data", os.path.join("public", "style.css") + os.pathsep + "public",
    "--add-data", os.path.join("public", "app.js") + os.pathsep + "public",
    # Hidden imports for pywebview WebView2 backend
    "--hidden-import=clr",
    "--hidden-import=webview.platforms.edgechromium",
    "--hidden-import=PIL",
    "--hidden-import=PIL.Image",
    # Collect all submodules for pywebview and Pillow
    "--collect-all=webview",
    "--collect-all=PIL",
    # Exclude unnecessary large modules
    "--exclude-module=tkinter",
    "--exclude-module=matplotlib",
    "--exclude-module=PyQt5",
    "--exclude-module=PyQt6",
    "--exclude-module=PySide2",
    "--exclude-module=PySide6",
])

# Copy config.example.json next to the EXE
dist_exe = os.path.join(SCRIPT_DIR, "dist", "UniViewer")
if os.path.exists(dist_exe):
    src = os.path.join(SCRIPT_DIR, "config.example.json")
    dst = os.path.join(dist_exe, "config.example.json")
    shutil.copy2(src, dst)
    print(f"\nCopied config.example.json -> {dst}")
    print(f"Build complete: {dist_exe}")
    print("\nTo distribute:")
    print(f"  1. Zip the dist/UniViewer/ folder")
    print(f"  2. On target machine: unzip, copy config.example.json -> config.json, edit path")
    print(f"  3. Double-click UniViewer.exe")
