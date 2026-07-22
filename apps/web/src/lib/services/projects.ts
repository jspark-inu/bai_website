import { getProject, listActiveProjects, listProjectActivity, listProjectMembers } from '../db/repositories/projects.ts';
import type { FlaskInt } from '../api-params.ts';

export function getActiveProjects() {
  return listActiveProjects();
}

export function getProjectDetail(id: FlaskInt) {
  const project = getProject(id);
  return project ? { project, members: listProjectMembers(id), activity: listProjectActivity(id) } : null;
}