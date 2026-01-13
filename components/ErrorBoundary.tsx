/**
 * 错误边界组件
 * 捕获组件树中的错误，提供友好的错误提示
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { consoleService } from '../services/consoleService';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
    
    // 记录到控制台服务
    consoleService.logErrorBoundary(error, errorInfo);
    
    // 可以在这里上报错误到监控服务
    // reportErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-xl p-8 max-w-2xl w-full border border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle size={24} className="text-red-400" />
              <h2 className="text-xl font-bold text-white">出现错误</h2>
            </div>
            
            <p className="text-slate-300 mb-4">
              应用遇到了一个错误。请尝试刷新页面或联系技术支持。
            </p>
            
            {/* 始终显示错误详情，方便调试 */}
            {this.state.error && (
              <div className="mb-4 p-4 bg-slate-900 rounded border border-slate-700">
                <p className="text-red-400 font-mono text-sm mb-2 break-words">
                  {this.state.error.toString()}
                </p>
                {this.state.error.stack && (
                  <pre className="text-xs text-slate-400 overflow-auto max-h-48 mb-2 whitespace-pre-wrap break-words">
                    {this.state.error.stack}
                  </pre>
                )}
                {this.state.errorInfo && (
                  <details className="mt-2">
                    <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400 mb-2">
                      组件堆栈信息
                    </summary>
                    <pre className="text-xs text-slate-400 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}
            
            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <RefreshCw size={16} />
                重试
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
