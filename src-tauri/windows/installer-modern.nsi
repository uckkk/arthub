; ArtHub 极简深色一键安装模板
; 完全自定义现代化界面，参考阶跃AI设计
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

; 使用 nsDialogs 创建完全自定义界面
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
; 深色主题颜色定义
; ========================================
!define COLOR_BG_DARK 0x1a1a1a
!define COLOR_BG_DARKER 0x0f0f0f
!define COLOR_TEXT_WHITE 0xffffff
!define COLOR_TEXT_GRAY 0x999999
!define COLOR_BUTTON_PRIMARY 0xff8c00
!define COLOR_INPUT_BG 0x2a2a2a

; ========================================
; 自定义页面变量
; ========================================
Var hwnd
Var hwndTitle
Var hwndSubtitle
Var hwndInstallButton
Var hwndProgress
Var hwndProgressText
Var hwndMinimizeBtn
Var hwndCloseBtn
Var hwndFinishButton
Var hwndFinishCheckbox
Var IsInstalling
Var IsFinished
Var hFontTitle
Var hFontSubtitle
Var hFontButton
Var ParentHWND

; ========================================
; 完全自定义安装页面
; ========================================
Page custom ModernInstallPage ModernInstallPageLeave

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
  
  ; 移除窗口边框和标题栏
  System::Call "user32::GetWindowLong(i $ParentHWND, i ${GWL_STYLE}) i .r1"
  IntOp $1 $1 & ~${WS_CAPTION}
  IntOp $1 $1 & ~${WS_THICKFRAME}
  IntOp $1 $1 & ~${WS_SYSMENU}
  IntOp $1 $1 & ~${WS_MINIMIZEBOX}
  IntOp $1 $1 & ~${WS_MAXIMIZEBOX}
  System::Call "user32::SetWindowLong(i $ParentHWND, i ${GWL_STYLE}, i r1)"
  
  ; 设置窗口大小（580x420）并居中
  System::Call "user32::GetSystemMetrics(i ${SM_CXSCREEN}) i .r1"
  System::Call "user32::GetSystemMetrics(i ${SM_CYSCREEN}) i .r2"
  IntOp $1 $1 - 580
  IntOp $1 $1 / 2
  IntOp $2 $2 - 420
  IntOp $2 $2 / 2
  System::Call "user32::SetWindowPos(i $ParentHWND, i 0, i r1, i r2, i 580, i 420, i ${SWP_NOZORDER}|${SWP_FRAMECHANGED})"
  
  ; 设置窗口背景色
  SetCtlColors $hwnd "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARK}"
  
  ; 创建字体
  CreateFont $hFontTitle "Microsoft YaHei UI" "42" "700"
  CreateFont $hFontSubtitle "Microsoft YaHei UI" "14" "400"
  CreateFont $hFontButton "Microsoft YaHei UI" "16" "600"
  
  ; 自定义标题栏（顶部深色条）
  ${NSD_CreateLabel} 0 0 580 45 ""
  Pop $hwndTitle
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARKER}"
  
  ; 标题文字
  ${NSD_CreateLabel} 25 12 400 25 "${PRODUCTNAME} 安装向导"
  Pop $hwndTitle
  SendMessage $hwndTitle ${WM_SETFONT} $hFontSubtitle 1
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARKER}"
  
  ; 最小化按钮
  ${NSD_CreateButton} 510 8 28 28 "−"
  Pop $hwndMinimizeBtn
  SetCtlColors $hwndMinimizeBtn "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARKER}"
  ${NSD_OnClick} $hwndMinimizeBtn OnMinimizeClick
  
  ; 关闭按钮
  ${NSD_CreateButton} 545 8 28 28 "×"
  Pop $hwndCloseBtn
  SetCtlColors $hwndCloseBtn "${COLOR_TEXT_WHITE}" "${COLOR_BG_DARKER}"
  ${NSD_OnClick} $hwndCloseBtn OnCloseClick
  
  ${If} $IsFinished == 1
    ; 显示完成页面
    Call ShowFinishUI
  ${ElseIf} $IsInstalling == 1
    ; 显示安装进度
    Call ShowProgressUI
  ${Else}
    ; 显示初始安装页面
    Call ShowInstallUI
  ${EndIf}
  
  nsDialogs::Show
FunctionEnd

Function ShowInstallUI
  ; 产品名称（大标题，居中）
  ${NSD_CreateLabel} 0 100 580 70 "${PRODUCTNAME}"
  Pop $hwndTitle
  SendMessage $hwndTitle ${WM_SETFONT} $hFontTitle 1
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "transparent"
  ${NSD_AddStyle} $hwndTitle ${SS_CENTER}|${SS_CENTERIMAGE}
  
  ; 副标题
  ${NSD_CreateLabel} 0 170 580 25 "游戏美术工作台"
  Pop $hwndSubtitle
  SendMessage $hwndSubtitle ${WM_SETFONT} $hFontSubtitle 1
  SetCtlColors $hwndSubtitle "${COLOR_TEXT_GRAY}" "transparent"
  ${NSD_AddStyle} $hwndSubtitle ${SS_CENTER}|${SS_CENTERIMAGE}
  
  ; 一键安装按钮（大型，居中，橙色）
  ${NSD_CreateButton} 190 250 200 65 "一键安装"
  Pop $hwndInstallButton
  SendMessage $hwndInstallButton ${WM_SETFONT} $hFontButton 1
  SetCtlColors $hwndInstallButton "${COLOR_TEXT_WHITE}" "${COLOR_BUTTON_PRIMARY}"
  ${NSD_AddStyle} $hwndInstallButton ${BS_CENTER}|${BS_VCENTER}|${BS_PUSHBUTTON}
  ${NSD_OnClick} $hwndInstallButton OnInstallClick
FunctionEnd

Function ShowProgressUI
  ; 产品名称（小一些）
  ${NSD_CreateLabel} 0 100 580 50 "${PRODUCTNAME}"
  Pop $hwndTitle
  SendMessage $hwndTitle ${WM_SETFONT} $hFontTitle 1
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "transparent"
  ${NSD_AddStyle} $hwndTitle ${SS_CENTER}|${SS_CENTERIMAGE}
  
  ; 进度条
  ${NSD_CreateProgressBar} 40 220 500 28
  Pop $hwndProgress
  SendMessage $hwndProgress ${PBM_SETRANGE} 0 "0|100"
  
  ; 进度文本
  ${NSD_CreateLabel} 0 260 580 30 "正在准备安装..."
  Pop $hwndProgressText
  SetCtlColors $hwndProgressText "${COLOR_TEXT_WHITE}" "transparent"
  ${NSD_AddStyle} $hwndProgressText ${SS_CENTER}|${SS_CENTERIMAGE}
FunctionEnd

Function ShowFinishUI
  ; 完成标题
  ${NSD_CreateLabel} 0 120 580 60 "${PRODUCTNAME} 安装完成"
  Pop $hwndTitle
  SendMessage $hwndTitle ${WM_SETFONT} $hFontTitle 1
  SetCtlColors $hwndTitle "${COLOR_TEXT_WHITE}" "transparent"
  ${NSD_AddStyle} $hwndTitle ${SS_CENTER}|${SS_CENTERIMAGE}
  
  ; 启动应用复选框
  ${NSD_CreateCheckbox} 190 220 200 30 "启动 ${PRODUCTNAME}"
  Pop $hwndFinishCheckbox
  SendMessage $hwndFinishCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0
  SetCtlColors $hwndFinishCheckbox "${COLOR_TEXT_WHITE}" "transparent"
  
  ; 完成按钮
  ${NSD_CreateButton} 240 280 100 50 "完成"
  Pop $hwndFinishButton
  SendMessage $hwndFinishButton ${WM_SETFONT} $hFontButton 1
  SetCtlColors $hwndFinishButton "${COLOR_TEXT_WHITE}" "${COLOR_BUTTON_PRIMARY}"
  ${NSD_OnClick} $hwndFinishButton OnFinishClick
FunctionEnd

Function ModernInstallPageLeave
  ${If} $IsFinished == 1
    ; 完成页面，允许离开
  ${ElseIf} $IsInstalling == 0
    ; 未开始安装，询问是否取消
    MessageBox MB_YESNO|MB_ICONQUESTION "确定要取消安装吗？" IDYES +2
    Abort
  ${Else}
    ; 正在安装中，不允许离开
    Abort
  ${EndIf}
FunctionEnd

Function OnInstallClick
  ${If} $IsInstalling == 1
    Return
  ${EndIf}
  
  StrCpy $IsInstalling 1
  
  ; 重新创建界面显示进度
  Call ShowProgressUI
  
  ; 开始安装（调用 Section）
  Call DoInstallation
  
  ; 安装完成
  StrCpy $IsFinished 1
  StrCpy $IsInstalling 0
  
  ; 重新创建界面显示完成页面
  Call ShowFinishUI
FunctionEnd

Function DoInstallation
  SetOutPath "$INSTDIR"
  
  ; 更新进度：10%
  SendMessage $hwndProgress ${PBM_SETPOS} 10 0
  ${NSD_SetText} $hwndProgressText "正在安装主程序..."
  File "${MAINBINARYSRCPATH}"
  
  ; 更新进度：30%
  SendMessage $hwndProgress ${PBM_SETPOS} 30 0
  ${NSD_SetText} $hwndProgressText "正在安装资源文件..."
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}
  
  ; 更新进度：60%
  SendMessage $hwndProgress ${PBM_SETPOS} 60 0
  ${NSD_SetText} $hwndProgressText "正在安装组件..."
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}
  
  ; 更新进度：80%
  SendMessage $hwndProgress ${PBM_SETPOS} 80 0
  ${NSD_SetText} $hwndProgressText "正在创建快捷方式..."
  CreateDirectory "$SMPROGRAMS\${PRODUCTNAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  
  ; 更新进度：90%
  SendMessage $hwndProgress ${PBM_SETPOS} 90 0
  ${NSD_SetText} $hwndProgressText "正在写入注册表..."
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
  
  ; 完成：100%
  SendMessage $hwndProgress ${PBM_SETPOS} 100 0
  ${NSD_SetText} $hwndProgressText "安装完成！"
  
  Sleep 800
FunctionEnd

Function OnFinishClick
  ${NSD_GetState} $hwndFinishCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    Exec "$INSTDIR\${MAINBINARYNAME}.exe"
  ${EndIf}
  Quit
FunctionEnd

Function OnMinimizeClick
  System::Call "user32::GetParent(i $hwnd) i .r0"
  Pop $ParentHWND
  System::Call "user32::ShowWindow(i $ParentHWND, i ${SW_MINIMIZE})"
FunctionEnd

Function OnCloseClick
  ${If} $IsInstalling == 1
    MessageBox MB_YESNO|MB_ICONQUESTION "安装正在进行中，确定要取消吗？" IDYES +2
    Return
  ${EndIf}
  System::Call "user32::GetParent(i $hwnd) i .r0"
  Pop $ParentHWND
  System::Call "user32::PostMessage(i $ParentHWND, i ${WM_CLOSE}, i 0, i 0)"
FunctionEnd

; ========================================
; 安装程序部分（保留用于静默安装）
; ========================================
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  
  File "${MAINBINARYSRCPATH}"
  
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}
  
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}
  
  CreateDirectory "$SMPROGRAMS\${PRODUCTNAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  
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
  
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

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
