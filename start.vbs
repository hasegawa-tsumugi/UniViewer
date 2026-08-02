Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run """C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\pythonw.exe"" """ & fso.GetParentFolderName(WScript.ScriptFullName) & "\main.py""", 0, False
