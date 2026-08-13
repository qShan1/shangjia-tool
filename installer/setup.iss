; 上架工具 Windows 安装器 (Inno Setup)
; 用 Inno Setup 打开本文件，编译生成 setup.exe。

[Setup]
; 注意：SourceDir 改为你的实际 dist 目录
SourceDir=..\dist\ShangjiaTool
OutputDir=..\installer\output
OutputBaseFilename=setup

AppName=上架工具
AppVersion=1.0.0
AppVerName=上架工具 v1.0.0
AppPublisher=qShan1
DefaultDirName={autopf}\ShangjiaTool
DefaultGroupName=上架工具
UninstallDisplayName=上架工具 v1.0.0
UninstallDisplayIcon={app}\ShangjiaTool.exe
SetupIconFile=..\static\ShangjiaTool.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标:"; Flags: unchecked

[Files]
Source: "*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\上架工具"; Filename: "{app}\ShangjiaTool.exe"
Name: "{group}\卸载上架工具"; Filename: "{uninstallexe}"
Name: "{autodesktop}\上架工具"; Filename: "{app}\ShangjiaTool.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\ShangjiaTool.exe"; Description: "运行上架工具"; Flags: nowait postinstall skipifsilent
