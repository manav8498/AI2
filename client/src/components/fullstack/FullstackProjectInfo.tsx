// client/src/components/fullstack/FullstackProjectInfo.tsx
import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ExternalLink, Server, Globe, Code, FileCode, RefreshCw, 
  Play, Square, Loader2, ChevronDown, ChevronUp 
} from "lucide-react";
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface FullstackProjectInfoProps {
  projectId: string;
  code: string;
  frontendUrl?: string;
  backendUrl?: string;
  projectType?: string;
  isFullstack?: boolean;
  isRunning: boolean;
  onStop: () => void;
  onStart: () => void;
  onCleanup: () => void;
}

export function FullstackProjectInfo({
  projectId,
  code,
  frontendUrl,
  backendUrl,
  projectType = 'static',
  isFullstack = false,
  isRunning,
  onStop,
  onStart,
  onCleanup
}: FullstackProjectInfoProps) {
  const [fileStructure, setFileStructure] = useState<Array<{path: string, isBackend: boolean}>>([]); 
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    // Parse file structure from code
    parseFileStructure(code);
    
    // Fetch logs periodically if the project is running
    if (isRunning) {
      fetchProjectStatus();
      const interval = setInterval(fetchProjectStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [code, isRunning, projectId]);

  const parseFileStructure = (code: string) => {
    const fileRegex = /\/\/\s*[-]+\s*([a-zA-Z0-9_/.]+)\s*[-]+/g;
    const files = [];
    let match;
    
    while ((match = fileRegex.exec(code)) !== null) {
      const path = match[1].trim();
      files.push({
        path,
        isBackend: path.startsWith('backend/')
      });
    }
    
    setFileStructure(files);
  };

  const fetchProjectStatus = async () => {
    try {
      const response = await fetch(`/api/fullstack/status/${projectId}`);
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error("Error fetching project status:", error);
    }
  };

  const handleStartProject = async () => {
    setIsLoading(true);
    await onStart();
    setIsLoading(false);
  };

  const handleStopProject = async () => {
    setIsLoading(true);
    await onStop();
    setIsLoading(false);
  };

  return (
    <Card className="mt-4">
      <CardHeader className="p-4 pb-2">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <FileCode className="h-5 w-5" />
            <h3 className="text-lg font-semibold">
              {isFullstack ? "Fullstack Project" : `${projectType.charAt(0).toUpperCase() + projectType.slice(1)} Project`}
            </h3>
            <Badge variant={isRunning ? "default" : "outline"} className="ml-2">
              {isRunning ? "Running" : "Stopped"}
            </Badge>
          </div>
          
          <div className="flex gap-2">
            {isRunning ? (
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={handleStopProject}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Square className="h-4 w-4 mr-1" />}
                Stop
              </Button>
            ) : (
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleStartProject}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                Start
              </Button>
            )}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onCleanup}
            >
              Delete Project
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-4 pt-0">
        <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview">
            {isRunning ? (
              <div className="space-y-4">
                <div className="grid gap-4">
                  <div className="border rounded-md p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="h-4 w-4" />
                      <h4 className="font-medium">Frontend</h4>
                    </div>
                    <div className="flex items-center justify-between">
                      <code className="text-sm bg-muted px-2 py-1 rounded">
                        {frontendUrl}
                      </code>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => window.open(frontendUrl, '_blank')}
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1" />
                        Open
                      </Button>
                    </div>
                  </div>
                  
                  {isFullstack && backendUrl && (
                    <div className="border rounded-md p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Server className="h-4 w-4" />
                        <h4 className="font-medium">Backend API</h4>
                      </div>
                      <div className="flex items-center justify-between">
                        <code className="text-sm bg-muted px-2 py-1 rounded">
                          {backendUrl}
                        </code>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => window.open(backendUrl, '_blank')}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          Open
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                
                <Alert>
                  <AlertDescription>
                    Your application is running and accessible via the URLs above. Any navigation between pages will work correctly when accessed through these URLs.
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <div className="border rounded-md p-6 text-center">
                <h3 className="text-lg font-medium mb-2">Project Ready</h3>
                <p className="text-muted-foreground mb-4">
                  Click "Start" to run the project and access it in your browser.
                </p>
                <Button onClick={handleStartProject} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                  Start Project
                </Button>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="files">
            <div className="border rounded-md">
              <div className="p-3 bg-muted/50 border-b">
                <h4 className="font-medium">Project Structure</h4>
              </div>
              <ScrollArea className="h-60 p-2">
                {fileStructure.length > 0 ? (
                  <div className="space-y-1">
                    {fileStructure
                      .sort((a, b) => a.path.localeCompare(b.path))
                      .map((file, index) => (
                        <div 
                          key={index} 
                          className={`pl-2 py-1 text-sm ${file.isBackend ? 'text-blue-600 dark:text-blue-400' : ''}`}
                        >
                          <Code className="h-3.5 w-3.5 inline-block mr-2" />
                          {file.path}
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="p-4 text-muted-foreground">No files found in the project structure.</p>
                )}
              </ScrollArea>
            </div>
          </TabsContent>
          
          <TabsContent value="logs">
            <div className="border rounded-md">
              <div className="p-3 bg-muted/50 border-b flex justify-between items-center">
                <h4 className="font-medium">Server Logs</h4>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={fetchProjectStatus}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <ScrollArea className="h-60">
                <div className="p-2 font-mono text-xs">
                  {logs.length > 0 ? (
                    logs.map((log, index) => (
                      <div 
                        key={index} 
                        className={`py-1 ${log.includes('Error') ? 'text-red-500' : ''}`}
                      >
                        {log}
                      </div>
                    ))
                  ) : (
                    <p className="p-2 text-muted-foreground">No logs available.</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}