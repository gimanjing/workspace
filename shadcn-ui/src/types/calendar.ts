export interface CalendarRecord {
  id: string;
  date: string;
  day: string;
  working_time: number;
  over_time: number;
}

export type CalendarWritable = Omit<CalendarRecord, 'id'>;