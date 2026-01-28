# 推送成功通知脚本
# 重要原则：此脚本仅在代码成功推送到 GitHub 后才会被调用
# 如果推送失败，Git hook 不会调用此脚本，因此不会显示通知
# 这样可以确保用户只在代码真正推送到 GitHub 后才收到通知
# 在 Git post-commit hook 中调用

param(
    [string]$Branch = "",
    [string]$ActionsUrl = ""
)

# 验证参数
if ([string]::IsNullOrEmpty($Branch)) {
    Write-Host "警告: 分支名未提供" -ForegroundColor Yellow
    $Branch = "未知分支"
}

# 验证参数
if ([string]::IsNullOrEmpty($Branch)) {
    Write-Host "警告: 分支名未提供" -ForegroundColor Yellow
    $Branch = "未知分支"
}

# 使用 Windows Toast 通知（Windows 10+）
function Show-ToastNotification {
    param(
        [string]$Title,
        [string]$Message,
        [string]$ActionUrl = ""
    )
    
    # 尝试使用 Windows 10+ 的 Toast 通知
    try {
        # 加载 Windows Runtime
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        
        # 创建 Toast XML
        $toastXml = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text>$Title</text>
            <text>$Message</text>
        </binding>
    </visual>
    <actions>
        <action content="查看构建" arguments="$ActionUrl" activationType="protocol"/>
    </actions>
</toast>
"@
        
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($toastXml)
        
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        $toast.ExpirationTime = [DateTimeOffset]::Now.AddMinutes(5)
        
        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("ArtHub")
        $notifier.Show($toast)
        
        return $true
    } catch {
        # Toast 通知失败，使用备用方法
        return $false
    }
}

# 使用消息框通知（备用方案）
function Show-MessageBox {
    param(
        [string]$Title,
        [string]$Message
    )
    
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
        return $true
    } catch {
        return $false
    }
}

# 主逻辑
$title = "✅ 代码已推送到 GitHub"
$message = "分支: $Branch`n`n代码已成功推送到远程仓库！`n`n请前往 GitHub Actions 构建应用。"

# 尝试显示 Toast 通知
$toastSuccess = Show-ToastNotification -Title $title -Message $message -ActionUrl $ActionsUrl

# 如果 Toast 失败，使用消息框
if (-not $toastSuccess) {
    Show-MessageBox -Title $title -Message $message | Out-Null
}

# 不再自动打开浏览器或询问用户
# 只在对话窗口显示提示信息
if ($ActionsUrl) {
    Write-Host ""
    Write-Host "GitHub Actions 链接: $ActionsUrl" -ForegroundColor Cyan
    Write-Host "如需查看构建状态，请手动访问上述链接" -ForegroundColor Gray
}
