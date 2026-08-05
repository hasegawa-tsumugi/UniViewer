Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

' Try to find pythonw.exe in several common locations
Dim pythonPaths(4)
pythonPaths(0) = "C:\Users\" & WshShell.ExpandEnvironmentStrings("%USERNAME%") & "\.workbuddy\binaries\python\envs\default\Scripts\pythonw.exe"
pythonPaths(1) = "C:\Python313\pythonw.exe"
pythonPaths(2) = "C:\Python312\pythonw.exe"
pythonPaths(3) = "C:\Python311\pythonw.exe"
pythonPaths(4) = "pythonw.exe"  ' fallback: hope it's in PATH

Dim pythonExe
pythonExe = ""
For Each p In pythonPaths
    If fso.FileExists(p) Then
        pythonExe = p
        Exit For
    End If
Next

If pythonExe = "" Then
    MsgBox "找不到 pythonw.exe。" & vbCrLf & vbCrLf & _
           "请确保 Python 3.11+ 已安装，或者将 pythonw.exe 所在目录加入系统 PATH。" & vbCrLf & vbCrLf & _
           "已尝试的路径：" & vbCrLf & _
           Join(pythonPaths, vbCrLf), vbCritical, "UniViewer 启动失败"
    WScript.Quit 1
End If

Dim scriptDir
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Dim mainPy
mainPy = scriptDir & "\main.py"
If Not fso.FileExists(mainPy) Then
    MsgBox "找不到 main.py。" & vbCrLf & vbCrLf & _
           "期望路径：" & mainPy & vbCrLf & vbCrLf & _
           "请确保 start.vbs 与 main.py 在同一目录下。", vbCritical, "UniViewer 启动失败"
    WScript.Quit 1
End If

WshShell.CurrentDirectory = scriptDir
WshShell.Run """" & pythonExe & """ """ & mainPy & """", 0, False