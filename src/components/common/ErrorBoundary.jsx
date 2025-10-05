import React from "react";
import { AlertCircle } from "lucide-react";

/**
 * Uygulama genelinde hataları yakalayan sınır.
 * Kullanım:
 * <ErrorBoundary><App/></ErrorBoundary>
 */
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, info) {
        // dilediğin log servisine buradan iletebilirsin
        console.error("[ErrorBoundary]", error, info);
    }
    render() {
        if (!this.state.hasError) return this.props.children;
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
                <div className="bg-gray-800/90 border border-red-500/30 rounded-xl p-6 max-w-md w-full">
                    <h2 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5" /> Something went wrong
                    </h2>
                    <pre className="text-xs text-red-200 bg-black/40 p-3 rounded max-h-48 overflow-auto">
                        {String(this.state.error)}
                    </pre>
                    <button
                        onClick={() => window.location.reload()}
                        className="w-full py-2 mt-3 bg-blue-600 hover:bg-blue-500 rounded-lg"
                    >
                        Reload
                    </button>
                </div>
            </div>
        );
    }
}
