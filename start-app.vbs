' Startet die Steuerung ohne sichtbares Konsolenfenster.
' Der volle Pfad zu node steht hier, weil wscript die PATH-Ergaenzungen
' einer interaktiven Sitzung nicht zwingend kennt.
Dim shell, fso, ordner, node
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ordner = fso.GetParentFolderName(WScript.ScriptFullName)
node = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"
shell.CurrentDirectory = ordner
shell.Run """" & node & """ """ & ordner & "\src\app\server.mjs""", 0, False
