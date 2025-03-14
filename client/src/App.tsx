import { useState, useEffect } from "react";
import { ChatInterface } from "./components/chat/chat-interface";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Play, Loader2 } from "lucide-react";

export default function App() {
  const [code, setCode] = useState("");
  const [output, setOutput] = useState("");
  const [webOutput, setWebOutput] = useState("");
  const [activeTab, setActiveTab] = useState<string>("preview");
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number>(1);
  const [codeLines, setCodeLines] = useState<string[]>([]);
  const [activeLine, setActiveLine] = useState<number>(-1);

  const handleCodeChange = (newCode: string) => {
    console.log(`Code updated (${newCode.length} chars)`);
    setCode(newCode);
    
    // Update code lines for animation
    const newLines = newCode.split('\n');
    setCodeLines(newLines);
    
    // Animate typing by incrementally revealing lines
    if (isGenerating) {
      // If we're generating, simulate typing effect
      setActiveLine(0);
      const interval = setInterval(() => {
        setActiveLine(prev => {
          if (prev < newLines.length - 1) {
            return prev + 1;
          } else {
            clearInterval(interval);
            return prev;
          }
        });
      }, 50);
      
      return () => clearInterval(interval);
    }
  };

  const handleOutputChange = (newOutput: string) => {
    setOutput(newOutput);
    // Switch to console output tab when there's output
    if (newOutput.trim()) {
      setActiveTab("console");
    }
  };

  const handleWebOutputChange = (newWebOutput: string) => {
    setWebOutput(newWebOutput);
    // Switch to preview tab when there's web output
    if (newWebOutput.trim()) {
      setActiveTab("preview");
      
      // Auto-open the preview in a new tab
      setTimeout(() => {
        const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(newWebOutput)}`;
        window.open(previewUrl, '_blank', 'noopener,noreferrer');
      }, 100);
    }
  };

  const runCode = async () => {
    if (!code.trim()) return;
    
    setIsGenerating(true);
    
    try {
      console.log("Running code execution...");
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      
      const result = await response.json();
      console.log("Execution result:", Object.keys(result));
      
      if (result.output) {
        setOutput(result.output);
        setActiveTab("console");
      }
      
      if (result.webOutput) {
        setWebOutput(result.webOutput);
        setActiveTab("preview");
        
        // Auto-open the preview in a new tab
        setTimeout(() => {
          const previewUrl = result.previewUrl || `data:text/html;charset=utf-8,${encodeURIComponent(result.webOutput)}`;
          window.open(previewUrl, '_blank', 'noopener,noreferrer');
        }, 100);
      }
      
      if (result.error) {
        setOutput(result.error);
        setActiveTab("console");
      }
    } catch (error) {
      console.error("Error executing code:", error);
      setOutput(error instanceof Error ? error.message : "Error executing code");
      setActiveTab("console");
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-run code when it changes and is not being generated
  useEffect(() => {
    // Only auto-run if not currently generating to avoid loops
    if (code.trim() && !isGenerating) {
      const timeoutId = setTimeout(() => {
        runCode();
      }, 1000); // Small delay to avoid running while user is typing
      
      return () => clearTimeout(timeoutId);
    }
  }, [code]);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="p-4 border-b">
        <h1 className="text-2xl font-bold">AI Code Generation System</h1>
      </header>
      
      <div className="flex flex-1 overflow-hidden">
        {/* Chat Interface */}
        <div className="w-1/3 border-r">
          <ChatInterface
            code={code}
            onCodeChange={handleCodeChange}
            onOutputChange={handleOutputChange}
            onWebOutputChange={handleWebOutputChange}
            onGeneratingChange={setIsGenerating}
            onSessionChange={setActiveSessionId}
            onRunCode={runCode}
          />
        </div>
        
        {/* Code Editor and Preview */}
        <div className="flex-1 flex flex-col">
          <div className="p-4 flex justify-between items-center">
            <h2 className="text-lg font-semibold">Code Editor</h2>
            <Button 
              onClick={runCode}
              disabled={!code.trim() || isGenerating}
              size="sm"
              className="flex items-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run
                </>
              )}
            </Button>
          </div>
          
          <div className="flex-1 p-4 pt-0 overflow-hidden">
            {isGenerating && codeLines.length > 0 ? (
              <div className="w-full h-full resize-none border rounded p-4 font-mono text-sm overflow-auto whitespace-pre">
                {codeLines.slice(0, activeLine + 1).join('\n')}
                <span className="animate-pulse">▋</span>
              </div>
            ) : (
              <textarea
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                className="w-full h-full resize-none border rounded p-4 font-mono text-sm"
                placeholder="Enter your code here... Dependencies will be installed automatically"
              />
            )}
          </div>
          
          <div className="border-t">
            <Tabs defaultValue="preview" value={activeTab} onValueChange={setActiveTab}>
              <div className="px-4 border-b">
                <TabsList>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                  <TabsTrigger value="console">Console Output</TabsTrigger>
                </TabsList>
              </div>
              
              <TabsContent value="preview" className="p-4 h-96 overflow-auto">
                {webOutput ? (
                  <iframe
                    srcDoc={webOutput}
                    className="w-full h-full border-0"
                    sandbox="allow-scripts allow-popups allow-forms allow-modals"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    {isGenerating ? (
                      <div className="flex flex-col items-center">
                        <Loader2 className="h-8 w-8 animate-spin mb-2" />
                        <p>Generating preview...</p>
                      </div>
                    ) : (
                      "Preview will appear here when you run web-based code"
                    )}
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="console" className="p-4 h-96 overflow-auto font-mono whitespace-pre-wrap text-sm">
                {output || (isGenerating ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin mr-2" />
                    Generating output...
                  </div>
                ) : "Console output will appear here when you run your code")}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}