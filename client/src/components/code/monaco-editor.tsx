import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import * as monaco from "monaco-editor";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function MonacoEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!editorRef.current) return;

    const editor = monaco.editor.create(editorRef.current, {
      value: "// Your generated code will appear here",
      language: "typescript",
      theme: "vs-dark",
      minimap: { enabled: false },
      automaticLayout: true,
    });

    const handleError = async () => {
      const code = editor.getValue();
      const markers = monaco.editor.getModelMarkers({});

      if (markers.length > 0) {
        try {
          const res = await apiRequest("POST", "/api/analyze-error", {
            error: markers[0].message,
            code
          });
          const data = await res.json();

          toast({
            title: "Error Analysis",
            description: data.analysis,
          });
        } catch (error) {
          toast({
            title: "Error",
            description: error instanceof Error ? error.message : "Failed to analyze error",
            variant: "destructive"
          });
        }
      }
    };

    editor.onDidChangeModelContent(() => {
      setTimeout(handleError, 1000);
    });

    return () => {
      editor.dispose();
    };
  }, []);

  return (
    <Card className="h-[600px] overflow-hidden">
      <div ref={editorRef} className="h-full w-full" />
    </Card>
  );
}