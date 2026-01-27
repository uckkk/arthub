; ArtHub 极简深色一键安装模板
; 现代风格，参考阶跃AI安装向导设计
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

; 使用 Modern UI 2 和 nsDialogs
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

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

; ========================================
; 深色主题颜色定义
; ========================================
!define COLOR_BG_DARK 0x1a1a1a
!define COLOR_BG_DARKER 0x0f0f0f
!define COLOR_TEXT_WHITE 0xffffff
!define COLOR_TEXT_GRAY 0xcccccc
!define COLOR_BUTTON_PRIMARY 0xff8c00
!define COLOR_INPUT_BG 0x2a2a2a
!define COLOR_BORDER 0x3a3a3a

; ========================================
; 极简深色主题配置（MUI2）
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
; 自定义安装页面变量
; ========================================
Var hwnd
Var hwndTitle
Var hwndSubtitle
Var hwndInstallButton
Var hwndPathLabel
Var hwndPathInput
Var hwndBrowseButton
Var hwndProgress
Var hwndProgressText
Var IsInstalling
Var hFontTitle
Var hFontSubtitle

; ========================================
; 自定义安装页面
; ========================================
Page custom ModernInstallPage ModernInstallPageLeave
!insertmacro MUI_PAGE_INSTFILES

; ========================================
; 完成页面
; ========================================
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
; 自定义安装页面函数
; ========================================
Function ModernInstallPage
  ; 创建自定义对话框
  nsDialogs::Create 1018
  Pop $hwnd
  
  ${If} $hwnd == error
    Abort
  ${EndIf}
  
  ; 设置对话框背景色
  SetCtlColors $hwnd "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARK}"
  
  ; 创建大标题字体
  CreateFont $hFontTitle "Microsoft YaHei UI" "32" "700"
  CreateFont $hFontSubtitle "Microsoft YaHei UI" "14" "400"
  
  ; 产品名称（大标题，居中）
  ${NSD_CreateLabel} 0 60 100% 50 "${PRODUCTNAME}"
  Pop $hwndTitle
  SendMessage $hwndTitle ${WM_SETFONT} $hFontTitle 1
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "transparent"
  ${NSD_AddStyle} $hwndTitle ${SS_CENTER}
  
  ; 副标题
  ${NSD_CreateLabel} 0 120 100% 30 "游戏美术工作台"
  Pop $hwndSubtitle
  SendMessage $hwndSubtitle ${WM_SETFONT} $hFontSubtitle 1
  SetCtlColors $hwndSubtitle "${COLOR_TEXT_GRAY}" "transparent"
  ${NSD_AddStyle} $hwndSubtitle ${SS_CENTER}
  
  ; 一键安装按钮（大型，居中）
  ${NSD_CreateButton} 200 200 200 60 "一键安装"
  Pop $hwndInstallButton
  SendMessage $hwndInstallButton ${WM_SETFONT} $hFontSubtitle 1
  SetCtlColors $hwndInstallButton "${COLOR_TEXT_WHITE}" "${COLOR_BUTTON_PRIMARY}"
  ${NSD_AddStyle} $hwndInstallButton ${BS_CENTER}|${BS_VCENTER}
  
  ; 安装路径标签
  ${NSD_CreateLabel} 50 300 100 20 "目标文件夹:"
  Pop $hwndPathLabel
  SetCtlColors $hwndPathLabel "${COLOR_TEXT_WHITE}" "transparent"
  
  ; 安装路径输入框
  ${NSD_CreateText} 50 325 400 30 "$INSTDIR"
  Pop $hwndPathInput
  SetCtlColors $hwndPathInput "${COLOR_TEXT_WHITE}" "${COLOR_INPUT_BG}"
  
  ; 浏览按钮
  ${NSD_CreateButton} 460 325 80 30 "浏览..."
  Pop $hwndBrowseButton
  SetCtlColors $hwndBrowseButton "${COLOR_TEXT_WHITE}" "${COLOR_INPUT_BG}"
  
  ; 进度条（初始隐藏）
  ${NSD_CreateProgressBar} 50 380 500 20
  Pop $hwndProgress
  ShowWindow $hwndProgress ${SW_HIDE}
  
  ; 进度文本（初始隐藏）
  ${NSD_CreateLabel} 50 410 500 20 ""
  Pop $hwndProgressText
  SetCtlColors $hwndProgressText "${COLOR_TEXT_WHITE}" "transparent"
  ShowWindow $hwndProgressText ${SW_HIDE}
  
  ; 设置回调
  ${NSD_OnClick} $hwndInstallButton OnInstallClick
  ${NSD_OnClick} $hwndBrowseButton OnBrowseClick
  
  StrCpy $IsInstalling 0
  
  nsDialogs::Show
FunctionEnd

Function ModernInstallPageLeave
  ${If} $IsInstalling == 0
    MessageBox MB_YESNO "确定要取消安装吗？" IDYES +2
    Abort
  ${EndIf}
FunctionEnd

Function OnInstallClick
  ${If} $IsInstalling == 1
    Return
  ${EndIf}
  
  StrCpy $IsInstalling 1
  
  ; 隐藏安装按钮和路径选择
  ShowWindow $hwndInstallButton ${SW_HIDE}
  ShowWindow $hwndPathInput ${SW_HIDE}
  ShowWindow $hwndBrowseButton ${SW_HIDE}
  ShowWindow $hwndPathLabel ${SW_HIDE}
  
  ; 显示进度条
  ShowWindow $hwndProgress ${SW_SHOW}
  ShowWindow $hwndProgressText ${SW_SHOW}
  
  ; 更新进度文本
  ${NSD_SetText} $hwndProgressText "正在准备安装..."
  
  ; 设置安装路径
  ${NSD_GetText} $hwndPathInput $0
  StrCpy $INSTDIR $0
  
  ; 允许继续到安装页面
FunctionEnd

Function OnBrowseClick
  nsDialogs::SelectFolderDialog "选择安装目录" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    StrCpy $INSTDIR $0
    ${NSD_SetText} $hwndPathInput $INSTDIR
  ${EndIf}
FunctionEnd

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
; 自定义安装页面文本
; ========================================
!define MUI_INSTFILESPAGE_TEXT_TOP "正在安装 ${PRODUCTNAME}..."
!define MUI_INSTFILESPAGE_TEXT_COMPONENTS_DESC ""

; ========================================
; 卸载程序部分
; ========================================
Section Uninstall
  ; 删除主程序
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"
  
  ; 删除资源文件
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}
  
  ; 删除外部二进制文件
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}
  
  ; 删除快捷方式
  Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCTNAME}"
  
  ; 删除卸载程序
  Delete "$INSTDIR\uninstall.exe"
  
  ; 删除注册表项
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${PRODUCTNAME}.exe"
  
  ; 删除安装目录
  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"
SectionEnd
