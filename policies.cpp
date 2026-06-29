#include "policies.h"
#include <random>
#include <iostream>
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
            //  cout << "LRU check line=" << line_idx
            //      << " last_access=" << set.lines[line_idx].last_access_time
            //      << " vs oldest=" << oldest_time << "\n";

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
               
            // cout << "FIFO check line=" << line_idx
            //      << " load_time=" << set.lines[line_idx].load_time
            //      << " vs oldest=" << oldest_time << "\n";
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

void load_line(Cache &cache, CacheLine &line)
{
    cache.current_time++;
    if (cache.policy == LRU)
    {
        line.last_access_time = cache.current_time;
        line.load_time = cache.current_time;
    }
    else if (cache.policy == FIFO)
    {
        line.load_time = cache.current_time;
        line.last_access_time = cache.current_time;
    }
   
}

void touch_line(Cache &cache, CacheLine &line)
{
    if (cache.policy == LRU)
    {
       
        cache.current_time++;
        line.last_access_time = cache.current_time;
    }
  
}