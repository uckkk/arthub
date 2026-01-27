; ArtHub Windows 11 风格极简安装模板
; 现代化卡片式界面，参考 Windows 11 Fluent Design
; 基于 Tauri 官方模板结构，使用 Handlebars 模板语法

Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

; 压缩方式
!if "{{compression}}" == "none"
  SetCompress off
!else
  SetCompressor /SOLID "{{compression}}"
!endif

; 使用 MUI2 和 nsDialogs
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

; ========================================
; 定义变量（必须在 OutFile 之前）
; ========================================
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define OUTFILE "{{out_file}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"

; ========================================
; 安装程序属性
; ========================================
Name "${PRODUCTNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES\${PRODUCTNAME}"
InstallDirRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${PRODUCTNAME}.exe" ""
RequestExecutionLevel admin

; 移除 NSIS 品牌标识
BrandingText " "

; ========================================
; Windows 11 风格颜色定义
; ========================================
!define COLOR_BG_DARK 0x202020
!define COLOR_BG_CARD 0x2a2a2a
!define COLOR_BG_DARKER 0x1a1a1a
!define COLOR_TEXT_WHITE 0xffffff
!define COLOR_TEXT_GRAY 0xb3b3b3
!define COLOR_BUTTON_PRIMARY 0x0078d4
!define COLOR_BUTTON_PRIMARY_HOVER 0x106ebe
!define COLOR_INPUT_BG 0x323232
!define COLOR_BORDER 0x404040
!define CORNER_RADIUS 12

; ========================================
; MUI2 深色主题配置
; ========================================
!define MUI_BGCOLOR "${COLOR_BG_DARK}"
!define MUI_TEXTCOLOR "${COLOR_TEXT_WHITE}"
!define MUI_HEADERBGCOLOR "${COLOR_BG_DARKER}"
!define MUI_HEADERTEXTCOLOR "${COLOR_TEXT_WHITE}"
!define MUI_INSTFILESPAGE_COLORS "${COLOR_TEXT_WHITE} ${COLOR_BG_DARK}"
!define MUI_BUTTONTEXTCOLOR "${COLOR_TEXT_WHITE}"

; 安装程序图标
!if "{{installer_icon}}" != ""
  !define MUI_ICON "{{installer_icon}}"
  !define MUI_UNICON "{{installer_icon}}"
!else
  !if /FileExists "icons\icon.ico"
    !define MUI_ICON "icons\icon.ico"
    !define MUI_UNICON "icons\icon.ico"
  !else
    !if /FileExists "..\icons\icon.ico"
      !define MUI_ICON "..\icons\icon.ico"
      !define MUI_UNICON "..\icons\icon.ico"
    !else
      !define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
      !define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
    !endif
  !endif
!endif

; ========================================
; 自定义页面变量
; ========================================
Var hwnd
Var hwndTitle
Var hwndSubtitle
Var hwndInstallButton
Var hwndPathLabel
Var hwndPathInput
Var hwndBrowseButton
Var hwndMinimizeBtn
Var hwndCloseBtn
Var hFontTitle
Var hFontSubtitle
Var hFontButton
Var ParentHWND
Var ShouldInstall
Var DialogHWND
Var WindowRegion

; ========================================
; 页面定义
; ========================================
; 自定义安装页面（在 INSTFILES 之前）
Page custom ModernInstallPage ModernInstallPageLeave
; 安装文件页面（执行 Section）
!insertmacro MUI_PAGE_INSTFILES
; 完成页面
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${PRODUCTNAME}"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"
!insertmacro MUI_PAGE_FINISH

; ========================================
; 卸载页面
; ========================================
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ========================================
; 语言
; ========================================
!insertmacro MUI_LANGUAGE "SimpChinese"

; ========================================
; Windows 11 圆角窗口函数
; ========================================
Function ApplyRoundedCorners
  ; 获取窗口大小
  System::Call "user32::GetWindowRect(i $ParentHWND, i .r0) i .r1"
  System::Call "*$0(i .r1, i .r2, i .r3, i .r4)"
  IntOp $3 $3 - $1  ; 宽度
  IntOp $4 $4 - $2  ; 高度
  
  ; 创建圆角区域
  System::Call "gdi32::CreateRoundRectRgn(i 0, i 0, i $3, i $4, i ${CORNER_RADIUS}, i ${CORNER_RADIUS}) i .r0"
  Pop $WindowRegion
  
  ; 应用圆角区域到窗口
  System::Call "user32::SetWindowRgn(i $ParentHWND, i $WindowRegion, i 1) i .r0"
FunctionEnd

; ========================================
; 自定义安装页面函数
; ========================================
Function ModernInstallPage
  ; 创建完全自定义对话框（1044 = 无标题栏样式）
  nsDialogs::Create 1044
  Pop $hwnd
  
  ${If} $hwnd == error
    Abort
  ${EndIf}
  
  ; 获取父窗口句柄
  System::Call "user32::GetParent(i $hwnd) i .r0"
  Pop $ParentHWND
  
  ; 获取对话框句柄（用于隐藏默认按钮和底部空白）
  FindWindow $DialogHWND "#32770" "" $ParentHWND
  
  ; 隐藏默认的"安装"和"取消"按钮
  GetDlgItem $0 $DialogHWND 1
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $DialogHWND 2
  ShowWindow $0 ${SW_HIDE}
  
  ; 移除窗口边框和标题栏
  System::Call "user32::GetWindowLong(i $ParentHWND, i ${GWL_STYLE}) i .r1"
  IntOp $1 $1 & ~${WS_CAPTION}
  IntOp $1 $1 & ~${WS_THICKFRAME}
  IntOp $1 $1 & ~${WS_SYSMENU}
  IntOp $1 $1 & ~${WS_MINIMIZEBOX}
  IntOp $1 $1 & ~${WS_MAXIMIZEBOX}
  IntOp $1 $1 & ~${WS_DLGFRAME}
  System::Call "user32::SetWindowLong(i $ParentHWND, i ${GWL_STYLE}, i r1)"
  
  ; 设置扩展样式，支持透明和分层窗口
  System::Call "user32::GetWindowLong(i $ParentHWND, i ${GWL_EXSTYLE}) i .r1"
  IntOp $1 $1 | ${WS_EX_LAYERED}
  System::Call "user32::SetWindowLong(i $ParentHWND, i ${GWL_EXSTYLE}, i r1)"
  
  ; 设置窗口大小（620x520，Windows 11 风格卡片尺寸）并居中
  System::Call "user32::GetSystemMetrics(i ${SM_CXSCREEN}) i .r1"
  System::Call "user32::GetSystemMetrics(i ${SM_CYSCREEN}) i .r2"
  IntOp $1 $1 - 620
  IntOp $1 $1 / 2
  IntOp $2 $2 - 520
  IntOp $2 $2 / 2
  System::Call "user32::SetWindowPos(i $ParentHWND, i 0, i r1, i r2, i 620, i 520, i ${SWP_NOZORDER}|${SWP_FRAMECHANGED})"
  
  ; 应用圆角窗口
  Call ApplyRoundedCorners
  
  ; 设置窗口背景色
  SetCtlColors $hwnd "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARK}"
  
  ; 创建字体（Windows 11 风格字体）
  CreateFont $hFontTitle "Segoe UI" "48" "600"
  CreateFont $hFontSubtitle "Segoe UI" "14" "400"
  CreateFont $hFontButton "Segoe UI" "16" "600"
  
  ; 主卡片背景（Windows 11 风格）
  ${NSD_CreateLabel} 20 20 580 480 ""
  Pop $hwndTitle
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "${COLOR_BG_CARD}"
  
  ; 应用图标区域（顶部居中）
  ${NSD_CreateLabel} 0 50 620 80 ""
  Pop $hwndTitle
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "transparent"
  ${NSD_AddStyle} $hwndTitle ${SS_CENTER}|${SS_CENTERIMAGE}
  
  ; 产品名称（大标题，居中，Windows 11 风格）
  ${NSD_CreateLabel} 0 120 620 70 "${PRODUCTNAME}"
  Pop $hwndTitle
  SendMessage $hwndTitle ${WM_SETFONT} $hFontTitle 1
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "transparent"
  ${NSD_AddStyle} $hwndTitle ${SS_CENTER}|${SS_CENTERIMAGE}
  
  ; 副标题（Windows 11 风格，更优雅的间距）
  ${NSD_CreateLabel} 0 190 620 30 "游戏美术工作台"
  Pop $hwndSubtitle
  SendMessage $hwndSubtitle ${WM_SETFONT} $hFontSubtitle 1
  SetCtlColors $hwndSubtitle "${COLOR_TEXT_GRAY}" "transparent"
  ${NSD_AddStyle} $hwndSubtitle ${SS_CENTER}|${SS_CENTERIMAGE}
  
  ; 一键安装按钮（Windows 11 风格，大按钮，圆角，蓝色）
  ${NSD_CreateButton} 210 280 200 50 "安装"
  Pop $hwndInstallButton
  SendMessage $hwndInstallButton ${WM_SETFONT} $hFontButton 1
  SetCtlColors $hwndInstallButton "${COLOR_TEXT_WHITE}" "${COLOR_BUTTON_PRIMARY}"
  ${NSD_AddStyle} $hwndInstallButton ${BS_CENTER}|${BS_VCENTER}|${BS_PUSHBUTTON}
  ${NSD_OnClick} $hwndInstallButton OnInstallClick
  
  ; 目标文件夹标签（Windows 11 风格，更小的字体）
  ${NSD_CreateLabel} 50 360 100 20 "目标文件夹:"
  Pop $hwndPathLabel
  SetCtlColors $hwndPathLabel "${COLOR_TEXT_GRAY}" "transparent"
  
  ; 安装路径输入框（Windows 11 风格，圆角输入框）
  ${NSD_CreateText} 50 385 420 36 "$INSTDIR"
  Pop $hwndPathInput
  SetCtlColors $hwndPathInput "${COLOR_TEXT_WHITE}" "${COLOR_INPUT_BG}"
  
  ; 浏览按钮（Windows 11 风格，次要按钮）
  ${NSD_CreateButton} 480 385 80 36 "浏览..."
  Pop $hwndBrowseButton
  SetCtlColors $hwndBrowseButton "${COLOR_TEXT_WHITE}" "${COLOR_INPUT_BG}"
  ${NSD_OnClick} $hwndBrowseButton OnBrowseClick
  
  ; 自定义标题栏（Windows 11 风格，无边框）
  ${NSD_CreateLabel} 0 0 620 40 ""
  Pop $hwndTitle
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARKER}"
  
  ; 标题文字
  ${NSD_CreateLabel} 30 10 400 25 "${PRODUCTNAME} 安装向导"
  Pop $hwndTitle
  SendMessage $hwndTitle ${WM_SETFONT} $hFontSubtitle 1
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARKER}"
  
  ; 最小化按钮（Windows 11 风格，更小更精致）
  ${NSD_CreateButton} 550 5 30 30 "−"
  Pop $hwndMinimizeBtn
  SetCtlColors $hwndMinimizeBtn "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARKER}"
  ${NSD_OnClick} $hwndMinimizeBtn OnMinimizeClick
  
  ; 关闭按钮（Windows 11 风格）
  Pop $hwndCloseBtn
  ${NSD_CreateButton} 585 5 30 30 "×"
  Pop $hwndCloseBtn
  SetCtlColors $hwndCloseBtn "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARKER}"
  ${NSD_OnClick} $hwndCloseBtn OnCloseClick
  
  StrCpy $ShouldInstall 0
  
  nsDialogs::Show
FunctionEnd

Function ModernInstallPageLeave
  ${If} $ShouldInstall == 0
    ; 用户没有点击安装，询问是否取消
    MessageBox MB_YESNO|MB_ICONQUESTION "确定要取消安装吗？" IDYES +2
    Abort
  ${EndIf}
  ; 用户点击了安装，允许继续到 INSTFILES 页面
FunctionEnd

Function OnInstallClick
  ; 获取安装路径
  ${NSD_GetText} $hwndPathInput $0
  StrCpy $INSTDIR $0
  
  StrCpy $ShouldInstall 1
  ; 使用正确的方式触发页面离开 - 发送 IDOK 消息
  SendMessage $ParentHWND ${WM_COMMAND} ${IDOK} 0
FunctionEnd

Function OnBrowseClick
  nsDialogs::SelectFolderDialog "选择安装目录" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    StrCpy $INSTDIR $0
    ${NSD_SetText} $hwndPathInput $INSTDIR
  ${EndIf}
FunctionEnd

Function OnMinimizeClick
  System::Call "user32::ShowWindow(i $ParentHWND, i ${SW_MINIMIZE})"
FunctionEnd

Function OnCloseClick
  MessageBox MB_YESNO|MB_ICONQUESTION "确定要取消安装吗？" IDYES +2
  Return
  System::Call "user32::PostMessage(i $ParentHWND, i ${WM_CLOSE}, i 0, i 0)"
FunctionEnd

; ========================================
; 自定义安装页面文本
; ========================================
!define MUI_INSTFILESPAGE_TEXT_TOP "正在安装 ${PRODUCTNAME}..."
!define MUI_INSTFILESPAGE_TEXT_COMPONENTS_DESC ""

; ========================================
; 安装程序部分
; ========================================
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  
  ; 安装主程序
  File "${MAINBINARYSRCPATH}"
  
  ; 安装资源文件
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}
  
  ; 安装外部二进制文件
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}
  
  ; 创建快捷方式
  CreateDirectory "$SMPROGRAMS\${PRODUCTNAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  
  ; 写入注册表
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${PRODUCTNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayIcon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayVersion" "${VERSION}"
  {{#if homepage}}
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "URLInfoAbout" "{{homepage}}"
  {{/if}}
  {{#if publisher}}
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "Publisher" "{{publisher}}"
  {{/if}}
  
  ; 创建卸载程序
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; ========================================
; 启动应用函数
; ========================================
Function LaunchApp
  Exec "$INSTDIR\${MAINBINARYNAME}.exe"
FunctionEnd

; ========================================
; 卸载程序部分
; ========================================
Section Uninstall
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"
  
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}
  
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}
  
  Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCTNAME}"
  
  Delete "$INSTDIR\uninstall.exe"
  
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${PRODUCTNAME}.exe"
  
  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"
SectionEnd
