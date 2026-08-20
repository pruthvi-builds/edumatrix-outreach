import { config } from './config.js';

function greeting(lead) {
  const name = (lead.values['Contact Person'] || '').trim();
  if (name) {
    // Use only the first token as a salutation-safe name (avoids "Dear Mrs. Sharma, Principal" duplication issues).
    return `Dear ${name},`;
  }
  return 'Dear Principal & Academic Team,';
}

function schoolName(lead) {
  return (lead.values['School'] || 'your school').trim() || 'your school';
}

function signOff() {
  const lines = [
    'Warm regards,',
    '',
    config.senderName,
    'Academic Content & Resource Development',
  ];
  if (config.senderPhone) lines.push(config.senderPhone);
  return lines.join('\n');
}

export function buildInitialEmail(lead) {
  const school = schoolName(lead);
  const board = (lead.values['Board'] || 'CBSE').trim() || 'CBSE';

  const subject = 'What if your teachers didn’t have to create it?';

  const body = `${greeting(lead)}

What if your teachers didn’t have to spend hours creating presentations, worksheets, assessments and classroom activities?

What if those resources were already being developed around ${school}'s curriculum, students and teaching approach?

That’s where EduMatrix Academic Solutions comes in.

We help ${board} schools develop custom academic resources for Grades 9–10 that are engaging, classroom-ready and aligned with their academic requirements — including:

- Engaging & interactive PPTs
- Lesson Plans & Teacher Guides
- Worksheets & Classroom Activities
- Question Banks & Assessments
- Competency-Based & Critical-Thinking Questions
- Projects, Revision & Intervention Materials

No fixed catalogue. No one-size-fits-all content. We create what your academic team actually needs.

Rather than asking you to take our word for it, we’d like to show you. If your team has one resource that needs to be created, improved or redesigned, share it with us — we’ll be happy to develop a complimentary sample for ${school}.

Would it be okay if I shared a sample with you?

${signOff()}

Building Stronger Classrooms Together`;

  return { subject, body };
}

export function buildFollowup1Email(lead) {
  const school = schoolName(lead);
  const subject = 'Re: What if your teachers didn’t have to create it?';
  const body = `${greeting(lead)}

Following up on my note below — I wanted to check if it reached the right person at ${school}.

We help CBSE schools with ready-to-use, curriculum-aligned lesson plans, worksheets, assessments and presentations for Grades 9–10, so teachers spend less time on prep and more time teaching.

Would it be okay if I shared a sample resource with you? Happy to tailor it to a topic your team is currently working on.

${signOff()}`;

  return { subject, body };
}

export function buildFollowup2Email(lead) {
  const school = schoolName(lead);
  const subject = 'Re: What if your teachers didn’t have to create it?';
  const body = `${greeting(lead)}

Just circling back once more — I don’t want to keep taking up your inbox.

If reducing your teachers’ prep workload with ready-to-use CBSE-aligned resources is useful for ${school} at some point, we’re happy to help whenever the timing is right. Would a quick 10-minute call work, or should I check back later in the term?

${signOff()}`;

  return { subject, body };
}

export function buildEmail(type, lead) {
  if (type === 'Initial') return buildInitialEmail(lead);
  if (type === 'Follow-up 1') return buildFollowup1Email(lead);
  if (type === 'Follow-up 2') return buildFollowup2Email(lead);
  throw new Error(`Unknown email type: ${type}`);
}
