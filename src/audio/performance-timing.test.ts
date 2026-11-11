import {expect,it} from 'vitest';
import {performanceTiming} from './performance-timing';
it('puts four quarter-note clicks before a sample-aligned onset',()=>{
  const plan=performanceTiming(120,'6/8','four',1.1,48000);
  expect(plan.onset).toBe(3.1);expect(plan.clicks.map(c=>Number(c.time.toFixed(3)))).toEqual([1.1,1.6,2.1,2.6]);expect(plan.onset*48000).toBe(Math.round(plan.onset*48000));
});
it('distinguishes one bar of eighth-note pulses from four quarter notes',()=>{
  const plan=performanceTiming(120,'6/8','bar',1,48000);expect(plan.clicks).toHaveLength(6);expect(plan.onset).toBe(2.5);
  const none=performanceTiming(120,'4/4','none',1,48000);expect(none.clicks).toHaveLength(0);expect(none.onset).toBe(1);
});
