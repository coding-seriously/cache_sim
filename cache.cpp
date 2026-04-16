#include <iostream>
#include <iomanip>
#include <cmath>
#include "cache.h"
#include "policies.h"

using namespace std;

void init_cache(Cache &cache, int cache_size, int block_size, int assoc, Policy policy)
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

    cache.sets.resize(cache.num_sets);

    for (int set_idx = 0; set_idx < cache.num_sets; set_idx++)
    {
        cache.sets[set_idx].lines.resize(assoc);
        for (int line_idx = 0; line_idx < assoc; line_idx++)
        {
            cache.sets[set_idx].lines[line_idx].valid = false;
            cache.sets[set_idx].lines[line_idx].dirty = false;
        }
    }
}

void access_cache(Cache &cache, address_t address, char operation)
{
    // FORCE ADDRESS INTO 256KB RANGE
    // 256 KB = 256 * 1024 = 262144 bytes
    address = address & 262143;

    int offset_bits = log2(cache.block_size);
    int index_bits = log2(cache.num_sets);

    int set_idx = (address >> offset_bits) & (cache.num_sets - 1);
    address_t tag = address >> (offset_bits + index_bits);

    CacheSet &set = cache.sets[set_idx];

    // HIT
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
            }

            if (operation == 'W')
            {
                set.lines[line_idx].dirty = true;
            }

            touch_line(cache, set.lines[line_idx]);
            return;
        }
    }

    // MISS
    cache.misses++;

    if (operation == 'R')
    {
        cache.read_misses++;
    }
    else if (operation == 'W')
    {
        cache.write_misses++;
    }

    int line_idx = choose_line(cache, set);

    // WRITE-BACK
    if (set.lines[line_idx].valid && set.lines[line_idx].dirty)
    {
        cache.write_backs++;
        cout << "Write-back occurred\n";
    }

    // INSERT
    set.lines[line_idx].tag = tag;
    set.lines[line_idx].valid = true;
    set.lines[line_idx].dirty = (operation == 'W');

    load_line(cache, set.lines[line_idx]);
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
    cout << endl;
    cout << "Total  Hit/Miss % : " << total_hit_rate << "% / " << total_miss_rate << "%" << endl;
    cout << "Read   Hit/Miss % : " << read_hit_rate << "% / " << read_miss_rate << "%" << endl;
    cout << "Write  Hit/Miss % : " << write_hit_rate << "% / " << write_miss_rate << "%" << endl;
    cout
        << endl;
}