#include <iostream>
#include <iomanip>
#include <cmath>
#include "cache.h"
#include "policies.h"

using namespace std;


auto int_log2 = [](int val) {
    int bits = 0;
    while (val > 1) { val >>= 1; bits++; }
    return bits;
};

void init_cache(Cache &cache, int cache_size, int block_size, int assoc, Policy policy, ReturnPolicy return_policy)
{
    cache.assoc = assoc;
    cache.block_size = block_size;
    cache.num_sets = cache_size / (block_size * assoc);
    cache.policy = policy;

    cache.hits = 0;
    cache.misses = 0;
    cache.read_hits = 0;
    cache.read_misses = 0;
    cache.write_hits = 0;
    cache.write_misses = 0;
    cache.current_time = 0;
    cache.write_backs = 0;
    cache.return_policy = return_policy; // 
    cache.mem_writes = 0;

    cache.sets.resize(cache.num_sets);

    for (int set_idx = 0; set_idx < cache.num_sets; set_idx++)
    {
        cache.sets[set_idx].lines.resize(assoc);
        for (int line_idx = 0; line_idx < assoc; line_idx++)
        {
            cache.sets[set_idx].lines[line_idx].valid = false;
            cache.sets[set_idx].lines[line_idx].dirty = false;
            cache.sets[set_idx].lines[line_idx].last_access_time = 0;
            cache.sets[set_idx].lines[line_idx].load_time = 0;
        }
    }
}

void access_cache(Cache &cache, address_t address, char operation)
{
    address = address & 262143; // bitmasking 256kb

    int offset_bits = int_log2(cache.block_size);
    int index_bits = int_log2(cache.num_sets);
    int set_idx = (address >> offset_bits) & (cache.num_sets - 1);
    address_t tag = address >> (offset_bits + index_bits);

    CacheSet &set = cache.sets[set_idx];

    // ── HIT CHECK ──────────────────────────────────────────────
    for (int line_idx = 0; line_idx < cache.assoc; line_idx++)
    {
        if (set.lines[line_idx].valid && set.lines[line_idx].tag == tag)
        {
            cache.hits++;

            if (operation == 'R')
            {
                cache.read_hits++;
            }
            else if (operation == 'W')
            {
                cache.write_hits++;

                if (cache.return_policy == WRITE_BACK)
                {
                    // mark dirty, write to memory only on eviction
                    set.lines[line_idx].dirty = true;
                }
                else
                {
                    // WRITE_THROUGH: write immediately to memory, block stays clean
                    cache.mem_writes++;
                    set.lines[line_idx].dirty = false; // never dirty in write-through
                }
            }

            touch_line(cache, set.lines[line_idx]); // updates cache
            return;
        }
    }

    // ── MISS ───────────────────────────────────────────────────
    cache.misses++;

    if (operation == 'R')
    {
        cache.read_misses++;
    }
    else if (operation == 'W')
    {
        cache.write_misses++;

        if (cache.return_policy == WRITE_THROUGH)
        {
           
            cache.mem_writes++;
            return; 
        }
        
    }
    int line_idx = choose_line(cache, set);

    if (set.lines[line_idx].valid && set.lines[line_idx].dirty)
    {
        
        cache.write_backs++;
        cache.mem_writes++;
        cout << "Write-back occurred " << "(evicting tag=" << set.lines[line_idx].tag << " from set=" << set_idx << ")\n";
    }

    set.lines[line_idx].tag = tag;
    set.lines[line_idx].valid = true;

    set.lines[line_idx].dirty = (operation == 'W' && cache.return_policy == WRITE_BACK);

    load_line(cache, set.lines[line_idx]); // update new data in cache line
}

void print_stats(const Cache &cache)
{
    int total_accesses = cache.hits + cache.misses;
    int read_accesses = cache.read_hits + cache.read_misses;
    int write_accesses = cache.write_hits + cache.write_misses;

    double total_hit_rate = total_accesses ? (100.0 * cache.hits / total_accesses) : 0.0;
    double total_miss_rate = total_accesses ? (100.0 * cache.misses / total_accesses) : 0.0;
    double read_hit_rate = read_accesses ? (100.0 * cache.read_hits / read_accesses) : 0.0;
    double read_miss_rate = read_accesses ? (100.0 * cache.read_misses / read_accesses) : 0.0;
    double write_hit_rate = write_accesses ? (100.0 * cache.write_hits / write_accesses) : 0.0;
    double write_miss_rate = write_accesses ? (100.0 * cache.write_misses / write_accesses) : 0.0;

    cout << fixed << setprecision(2);
    cout << "\nCache Statistics :- " << endl;
    cout << "Total Accesses : " << total_accesses << endl;
    cout << "Read Accesses  : " << read_accesses << endl;
    cout << "Write Accesses : " << write_accesses << endl;
    cout << endl;
    cout << "Total Hits     : " << cache.hits << endl;
    cout << "Total Misses   : " << cache.misses << endl;
    cout << "Read Hits      : " << cache.read_hits << endl;
    cout << "Read Misses    : " << cache.read_misses << endl;
    cout << "Write Hits     : " << cache.write_hits << endl;
    cout << "Write Misses   : " << cache.write_misses << endl;
    cout << "Write-backs    : " << cache.write_backs << endl;
    cout << "Memory Writes  : " << cache.mem_writes << endl;
    cout << endl;
    cout << "Total  Hit/Miss % : " << total_hit_rate << "% / " << total_miss_rate << "%" << endl;
    cout << "Read   Hit/Miss % : " << read_hit_rate << "% / " << read_miss_rate << "%" << endl;
    cout << "Write  Hit/Miss % : " << write_hit_rate << "% / " << write_miss_rate << "%" << endl;
    cout
        << endl;
}