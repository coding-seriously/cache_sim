#ifndef CACHE_H
#define CACHE_H
#include <vector>
#include <cstdint>
using namespace std;

using address_t = uint64_t;

enum Policy
{
    LRU,
    FIFO,
    RANDOM
};

struct CacheLine
{
    address_t tag;
    bool valid;
    int last_access_time;
    int load_time;
    bool dirty;
};

struct CacheSet
{
    vector<CacheLine> lines;
};

struct Cache
{
    vector<CacheSet> sets;
    int num_sets;
    int assoc;
    int block_size;
    int hits;
    int misses;
    int read_hits;
    int read_misses;
    int write_hits;
    int write_misses;
    int current_time;
    int write_backs;
    Policy policy;
};

// functions
void init_cache(Cache &cache, int cache_size, int block_size, int assoc, Policy policy);
void access_cache(Cache &cache, address_t address, char operation);
void print_stats(const Cache &cache);

#endif