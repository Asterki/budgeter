/**
 * Renders a list of tasks plus their subtasks, to any depth.
 *
 * Expansion and the inline "add subtask" composer are owned here, so every view
 * that shows tasks gets identical nesting behaviour for free.
 */

import { Fragment, useCallback, useState } from 'react';
import type { Task } from '../domain/types';
import { QuickAdd } from './QuickAdd';
import { TaskRow } from './TaskRow';

interface TaskTreeProps {
  tasks: Task[];
  childrenMap: Map<string, Task[]>;
  onOpenTask: (task: Task) => void;
  showProject?: boolean;
  /** Ids that start out expanded. */
  initiallyExpanded?: string[];
}

export function TaskTree({
  tasks,
  childrenMap,
  onOpenTask,
  showProject = true,
  initiallyExpanded,
}: TaskTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initiallyExpanded ?? []));
  const [composing, setComposing] = useState<string | null>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openComposer = useCallback((id: string) => {
    setExpanded((prev) => new Set(prev).add(id));
    setComposing((current) => (current === id ? null : id));
  }, []);

  const renderNode = (task: Task, depth: number) => {
    const children = childrenMap.get(task.id) ?? [];
    const done = children.reduce((count, child) => count + (child.completed ? 1 : 0), 0);
    const isOpen = expanded.has(task.id);

    return (
      <Fragment key={task.id}>
        <TaskRow
          task={task}
          onOpen={onOpenTask}
          showProject={showProject}
          depth={depth}
          childCount={children.length}
          doneChildCount={done}
          expanded={isOpen}
          onToggleExpand={toggleExpand}
          onAddSubtask={openComposer}
        />

        {composing === task.id && (
          <li className="task-tree__composer" style={{ ['--depth' as string]: depth + 1 }}>
            <QuickAdd
              compact
              autoFocus
              parentId={task.id}
              projectId={task.projectId}
              defaultDate={task.date}
              placeholder={`New subtask in “${task.title}”…`}
              onSubmitted={() => setComposing(null)}
            />
          </li>
        )}

        {isOpen && children.map((child) => renderNode(child, depth + 1))}
      </Fragment>
    );
  };

  return <ul className="task-list">{tasks.map((task) => renderNode(task, 0))}</ul>;
}
