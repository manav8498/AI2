import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, File } from "lucide-react";
import type { GeneratedFile } from "@shared/schema";

export function FileTree() {
  const { data: files = [], isLoading } = useQuery<GeneratedFile[]>({
    queryKey: ["/api/files"],
  });

  return (
    <Card className="h-[600px]">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold">Project Structure</h2>
      </div>

      <ScrollArea className="h-[calc(600px-65px)] p-4">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse h-6 bg-muted rounded" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((file: GeneratedFile) => (
              <div key={file.id} className="flex items-center gap-2 text-sm">
                {file.path.endsWith("/") ? (
                  <Folder className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground" />
                )}
                {file.path}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}