import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Play, Square, ExternalLink, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Global flag to prevent duplicate tab opening across component renders
let HAS_AUTO_OPENED_GLOBAL = false;

type CodeSandboxProps = {
  initialCode: string;
  output: string;
  webOutput: string;
  isGenerating: boolean;
  sessionId: number | null;
  onCodeChange: (code: string) => void;
  onOutputChange: (output: string) => void;
  onWebOutputChange: (webOutput: string) => void;
};

export function CodeSandbox({ 
  initialCode, 
  output, 
  webOutput, 
  isGenerating,
  sessionId,
  onCodeChange,
  onOutputChange,
  onWebOutputChange
}: CodeSandboxProps) {
  const [code, setCode] = useState<string>(initialCode);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("preview");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const codeEditorRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  // Add direct console.log outside any hooks or functions - this should always appear
  if (typeof window !== 'undefined') {
    // This will run on the client side
    window.console.log('[DIRECT LOG] CodeSandbox render with webOutput length:', webOutput?.length || 0);
    window.console.log('[DIRECT LOG] Current HAS_AUTO_OPENED_GLOBAL value:', HAS_AUTO_OPENED_GLOBAL);
  }

  // Update local code when initialCode changes
  useEffect(() => {
    window.console.log('[useEffect] initialCode changed, length:', initialCode?.length || 0);
    setCode(initialCode);
    
    // Reset auto-open flag when code changes completely
    if (initialCode !== code) {
      window.console.log('[useEffect] Resetting HAS_AUTO_OPENED_GLOBAL due to new initialCode');
      HAS_AUTO_OPENED_GLOBAL = false;
    }
  }, [initialCode, code]);

  const executeCode = useMutation({
    mutationFn: async (code: string) => {
      window.console.log('[executeCode] Starting execution');
      setIsRunning(true);
      
      // First try to detect and install any required dependencies
      const dependencyMatch = code.match(/(?:import|require)\s+['"]([^'"]+)['"]/g);
      if (dependencyMatch) {
        const dependencies = dependencyMatch
          .map(match => match.match(/['"]([^'"]+)['"]/)?.[1])
          .filter(dep => !dep?.startsWith('.') && !dep?.startsWith('/')) as string[];

        if (dependencies.length > 0) {
          await apiRequest("POST", "/api/install-dependencies", { dependencies });
        }
      }

      // Then execute the code
      return apiRequest("POST", "/api/execute", { code });
    },
    onSuccess: async (response) => {
      window.console.log('[executeCode] Execution successful');
      
      const result = await response.json();
      window.console.log('[executeCode] Response data:', {
        hasOutput: !!result.output, 
        hasWebOutput: !!result.webOutput,
        hasPreviewUrl: !!result.previewUrl
      });
      
      // Update state with results
      if (result.output) {
        onOutputChange(result.output);
      }
      
      if (result.webOutput) {
        onWebOutputChange(result.webOutput);
        
        if (result.previewUrl) {
          setPreviewUrl(result.previewUrl);
        } else {
          // If no previewUrl provided but we have webOutput, create one
          const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(result.webOutput)}`;
          setPreviewUrl(dataUrl);
        }
        
        // Switch to preview tab when there's web output
        setActiveTab("preview");
      }
      
      setIsRunning(false);
      
      // Auto-opening is completely disabled in the CodeSandbox component
      // This ensures no duplicate tabs are opened
      // The ChatInterface component will handle the auto-opening instead
      window.console.log('[executeCode] Auto-opening is disabled in CodeSandbox to prevent duplicates');
      
      toast({
        title: "Code executed successfully",
        description: result.webOutput ? "Preview is available" : "Check the console output",
      });
    },
    onError: async (error) => {
      window.console.error('[executeCode] Error executing code:', error);
      
      try {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const res = await apiRequest("POST", "/api/analyze-error", {
          error: errorMessage,
          code
        });
        const analysis = await res.json();

        toast({
          title: "Error Analysis",
          description: "Attempting to fix the error automatically...",
        });

        if (analysis.fixedCode) {
          setCode(analysis.fixedCode);
          onCodeChange(analysis.fixedCode);
          executeCode.mutate(analysis.fixedCode);
        } else {
          setIsRunning(false);
          toast({
            title: "Error executing code",
            description: "Could not automatically fix the error: " + errorMessage,
            variant: "destructive",
          });
        }
      } catch (analysisError) {
        window.console.error('[executeCode] Error analysis failed:', analysisError);
        
        setIsRunning(false);
        toast({
          title: "Error executing code",
          description: error instanceof Error ? error.message : "Failed to execute code",
          variant: "destructive",
        });
      }
    },
  });

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setCode(newCode);
    onCodeChange(newCode);
    
    // Reset auto-open flag when code changes manually
    window.console.log('[handleCodeChange] Resetting HAS_AUTO_OPENED_GLOBAL due to manual code change');
    HAS_AUTO_OPENED_GLOBAL = false;
  };

  const handleRun = () => {
    if (!code.trim()) {
      toast({
        title: "No code to execute",
        description: "Please enter some code first",
        variant: "destructive",
      });
      return;
    }
    
    window.console.log('[handleRun] Manual run initiated');
    executeCode.mutate(code);
  };

  const handleStop = () => {
    window.console.log('[handleStop] Stopping execution');
    setIsRunning(false);
  };

  const openPreview = () => {
    window.console.log('[openPreview] Opening preview manually');
    
    if (webOutput) {
      if (previewUrl) {
        window.open(previewUrl, '_blank', 'noopener,noreferrer');
      } else {
        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(webOutput)}`;
        window.open(dataUrl, '_blank', 'noopener,noreferrer');
      }
    } else {
      toast({
        title: "No preview available",
        description: "Run your code to generate a preview first",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4 flex flex-col h-full">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        <Card className="flex flex-col">
          <div className="p-4 border-b flex justify-between items-center">
            <h2 className="text-lg font-semibold">Code Editor</h2>
            <div className="space-x-2">
              <Button
                variant={isRunning ? "destructive" : "default"}
                size="sm"
                onClick={isRunning ? handleStop : handleRun}
                disabled={executeCode.isPending || isGenerating}
              >
                {isRunning ? (
                  <>
                    <Square className="h-4 w-4 mr-2" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="flex-1 p-4 min-h-0 overflow-hidden">
            <Textarea
              ref={codeEditorRef}
              value={code}
              onChange={handleCodeChange}
              placeholder="Enter your code here... Dependencies will be installed automatically"
              className="h-full font-mono resize-none overflow-auto"
              spellCheck={false}
              style={{ minHeight: "500px" }}
              disabled={isGenerating}
            />
          </div>
        </Card>

        <Card className="flex flex-col">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
            <div className="p-2 border-b flex items-center justify-between">
              <TabsList className="flex">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="console">Console Output</TabsTrigger>
              </TabsList>
              
              {/* External preview button */}
              <Button
                variant="outline"
                size="sm"
                onClick={openPreview}
                disabled={!webOutput}
                className="ml-2 focus:ring-0 flex gap-1.5"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Open</span>
              </Button>
            </div>

            <TabsContent value="preview" className="flex-1 p-4 h-full">
              {webOutput ? (
                <iframe
                  srcDoc={webOutput}
                  className="w-full h-full border-0 rounded-md"
                  sandbox="allow-scripts allow-same-origin"
                  style={{ minHeight: "500px" }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  {isGenerating ? (
                    <div className="flex flex-col items-center">
                      <Loader2 className="h-8 w-8 animate-spin mb-4" />
                      <p>Generating code...</p>
                    </div>
                  ) : (
                    "Preview will appear here when you run web-based code"
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="console" className="flex-1 h-full">
              <div className="h-full p-4 bg-muted/30 rounded-md overflow-auto">
                <pre className="font-mono text-sm whitespace-pre-wrap">
                  {output || (isGenerating ? "Generating code..." : "Output will appear here...")}
                </pre>
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}