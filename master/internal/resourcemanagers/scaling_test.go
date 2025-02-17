package resourcemanagers

import (
	"testing"

	"gotest.tools/assert"

	"github.com/determined-ai/determined/master/pkg/actor"
)

func TestCalculatingDesiredInstanceNum(t *testing.T) {
	system := actor.NewSystem(t.Name())

	// Test tasks with groups with maxSlots
	agents := []*mockAgent{}
	groups := []*mockGroup{
		{id: "group1", maxSlots: newMaxSlot(1), weight: 1},
		{id: "group2", maxSlots: newMaxSlot(2), weight: 1},
		{id: "group3"},
		{id: "group4", maxSlots: newMaxSlot(10), weight: 1},
	}
	tasks := []*mockTask{
		{id: "task1", slotsNeeded: 1, group: groups[0]},
		{id: "task2", slotsNeeded: 1, group: groups[0]},
		{id: "task3", slotsNeeded: 3, group: groups[0]},
		{id: "task4", slotsNeeded: 4, group: groups[1]},
		{id: "task5", slotsNeeded: 1, group: groups[1]},
		{id: "task6", slotsNeeded: 1, group: groups[2]},
		{id: "task7", slotsNeeded: 3, group: groups[2]},
		{id: "task8", slotsNeeded: 15, group: groups[3]},
		{id: "task9", slotsNeeded: 10, group: groups[2]},
	}

	taskList, groupMap, _ := setupSchedulerStates(t, system, tasks, groups, agents)

	// task 1, task 2, task 3 are in a group with maxSlots = 1 and total slots needed = 5
	// task 4, task 5 are in a group with maxSlots = 2 and total slots needed = 5
	// task 6, task 7 are in group with no maxSlots and total slots needed = 4
	// task 8 is in a group with max slots = 15 and total slots needed = 10
	// task 9 is in a group with no max slots and slots needed = 10
	// The feasible total SlotSum (with maxSlots of each group taken into account) = 26.
	// ceil(26/5) = 6
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, groupMap, 5, 10), 6)

	system = actor.NewSystem(t.Name())
	taskList = newTaskList()

	// Test one-slot allocated and pending tasks.

	forceAddTask(t, system, taskList, "task1", 1, 1)
	forceAddTask(t, system, taskList, "task2", 0, 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 100), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 100), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 100), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 0), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 0), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 0), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 1), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 1), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 1), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 2), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 2), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 2), 1)

	// Test more one-slot allocated and pending tasks.
	forceAddTask(t, system, taskList, "task3", 0, 1)
	forceAddTask(t, system, taskList, "task4", 1, 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 100), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 100), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 100), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 0), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 0), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 0), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 1), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 1), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 1), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 2), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 2), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 2), 1)

	// Test existing task got allocated/preempted.
	forceSetTaskAllocations(t, taskList, "task3", 1)
	forceSetTaskAllocations(t, taskList, "task4", 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 100), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 100), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 100), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 0), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 0), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 0), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 1), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 1), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 1), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 2), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 2), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 2), 1)

	// Test zero slot tasks.
	forceAddTask(t, system, taskList, "task5", 0, 0)
	forceAddTask(t, system, taskList, "task6", 1, 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 100), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 100), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 100), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 0), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 0), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 0), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 1), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 1), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 1), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 2), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 2), 2)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 2), 1)

	// Test distributed training tasks.
	forceAddTask(t, system, taskList, "task7", 0, 4)
	forceAddTask(t, system, taskList, "task8", 1, 4)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 100), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 100), 6)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 100), 3)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 0), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 0), 6)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 0), 3)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 1), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 1), 6)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 1), 3)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 2), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 2), 6)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 2), 3)

	// Test unschedulable distributed training tasks.
	forceAddTask(t, system, taskList, "task9", 0, 3)
	forceAddTask(t, system, taskList, "task10", 1, 3)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 100), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 100), 9)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 100), 3)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 0), 0)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 0), 9)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 0), 3)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 1), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 1), 9)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 1), 3)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 0, 2), 1)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 1, 2), 9)
	assert.Equal(t, calculateDesiredNewAgentNum(taskList, nil, 2, 2), 3)
}
