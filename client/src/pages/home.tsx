// client/src/pages/home.tsx
import { useState, useEffect } from "react";
import { ChatInterface } from "@/components/chat/chat-interface";
import { CodeSandbox } from "@/components/code/code-sandbox";

export default function Home() {
  const [code, setCode] = useState("");
  const [output, setOutput] = useState("");
  const [webOutput, setWebOutput] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(1); // Default to 1
  const [isGenerating, setIsGenerating] = useState(false);

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
  };

  const handleOutputChange = (newOutput: string) => {
    setOutput(newOutput);
  };

  const handleWebOutputChange = (newWebOutput: string) => {
    setWebOutput(newWebOutput);
  };

  const handleGenerationStateChange = (state: boolean) => {
    setIsGenerating(state);
  };

  const handleSessionChange = (sessionId: number) => {
    setActiveSessionId(sessionId);
  };

  const handleRunCode = () => {
    // This function can be empty as the code execution is handled in CodeSandbox directly
    console.log("Running code from parent component");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-4">
        <h1 className="text-3xl font-bold text-foreground mb-4 bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
          AI Code Generation System
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-120px)]">
          <div className="lg:col-span-3">
            <ChatInterface 
              code={code}
              onCodeChange={handleCodeChange}
              onOutputChange={handleOutputChange}
              onWebOutputChange={handleWebOutputChange}
              onGeneratingChange={handleGenerationStateChange}
              onSessionChange={handleSessionChange}
              onRunCode={handleRunCode}
            />
          </div>

          <div className="lg:col-span-9 h-full">
            <CodeSandbox 
              initialCode={code}
              output={output}
              webOutput={webOutput}
              isGenerating={isGenerating}
              sessionId={activeSessionId}
              onCodeChange={handleCodeChange}
              onOutputChange={handleOutputChange}
              onWebOutputChange={handleWebOutputChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}