#include "policies.h"
#include <random>
using namespace std;

int choose_line(Cache &cache, CacheSet &set)
{

    // empty line first
    for (int line_idx = 0; line_idx < cache.assoc; line_idx++)
    {
        if (!set.lines[line_idx].valid)
            return line_idx;
    }

    int chosen_idx = 0;

    if (cache.policy == LRU)
    {
        int oldest_time = set.lines[0].last_access_time;
        for (int line_idx = 1; line_idx < cache.assoc; line_idx++)
        {
            if (set.lines[line_idx].last_access_time < oldest_time)
            {
                oldest_time = set.lines[line_idx].last_access_time;
                chosen_idx = line_idx;
            }
        }
    }
    else if (cache.policy == FIFO)
    {
        int oldest_time = set.lines[0].load_time;
        for (int line_idx = 1; line_idx < cache.assoc; line_idx++)
        {
            if (set.lines[line_idx].load_time < oldest_time)
            {
                oldest_time = set.lines[line_idx].load_time;
                chosen_idx = line_idx;
            }
        }
    }
    else if (cache.policy == RANDOM)
    {
        static random_device random_device;
        static mt19937 generator(random_device());
        uniform_int_distribution<int> distribution(0, cache.assoc - 1);
        chosen_idx = distribution(generator);
    }

    return chosen_idx;
}

void touch_line(Cache &cache, CacheLine &line)
{
    if (cache.policy == LRU)
    {
        cache.current_time++;
        line.last_access_time = cache.current_time;
    }
}

void load_line(Cache &cache, CacheLine &line)
{
    cache.current_time++;

    if (cache.policy == LRU)
    {
        line.last_access_time = cache.current_time;
    }
    else if (cache.policy == FIFO)
    {
        line.load_time = cache.current_time;
    }
}