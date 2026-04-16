#include <iostream>
#include <fstream>
#include <string>
#include "cache.h"

using namespace std;

Policy parse_policy(int policy_choice)
{
    if (policy_choice == 0)
        return LRU;
    if (policy_choice == 1)
        return FIFO;
    return RANDOM;
}

int main()
{
    Cache cache;
    int cache_size;
    int block_size;
    int assoc;
    int policy_choice;
    string trace_path;
    Policy policy;

    cout << "Enter cache size (in KB): ";
    cin >> cache_size;
    cache_size *= 1024;

    cout << "Enter block size (in bytes): ";
    cin >> block_size;

    cout << "Enter associativity (number of lines per set): ";
    cin >> assoc;

    cout << "Enter policy (0 = lru, 1 = fifo, 2 = random): ";
    cin >> policy_choice;

    cout << "Enter trace file path: ";
    cin >> trace_path;

    policy = parse_policy(policy_choice);

    init_cache(cache, cache_size, block_size, assoc, policy);

    ifstream file(trace_path);
    if (!file)
    {
        cerr << "Could not open trace file: " << trace_path << endl;
        return 1;
    }

    char operation;
    address_t address;

    while (file >> operation >> hex >> address)
    {
        access_cache(cache, address, operation);
    }

    print_stats(cache);

    return 0;
}