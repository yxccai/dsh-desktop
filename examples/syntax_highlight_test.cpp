#include <algorithm>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

namespace demo {

struct Task {
    std::string name;
    int priority;
    bool completed;
};

class TaskBoard {
public:
    explicit TaskBoard(std::string title)
        : title_(std::move(title)) {}

    void add(Task task) {
        tasks_.push_back(std::move(task));
    }

    void print() const {
        std::cout << "== " << title_ << " ==\n";
        for (const auto& task : tasks_) {
            std::cout << task.priority << " | "
                      << (task.completed ? "done" : "pending")
                      << " | " << task.name << '\n';
        }
    }

private:
    std::string title_;
    std::vector<Task> tasks_;
};

} // namespace demo

int main() {
    auto board = std::make_unique<demo::TaskBoard>("DSH Preview Test");
    board->add({"Syntax highlighting", 10, true});
    board->add({"Green added lines", 20, false});
    board->add({"Red deleted lines", 30, false});

    // Second edit: exercise templates, lambdas, constants, and control flow.
    constexpr int minimumPriority = 15;
    const auto isImportant = [minimumPriority](const demo::Task& task) {
        return !task.completed && task.priority >= minimumPriority;
    };

    const std::vector<demo::Task> candidates {
        {"Review diff colors", 25, false},
        {"Close preview tab", 5, true},
    };
    const auto count = std::count_if(candidates.begin(), candidates.end(), isImportant);
    std::cout << "Important pending tasks: " << count << '\n';

    // Third edit: committed changes remain recoverable through DSH snapshots.
    if (count > 0) {
        std::cout << "Snapshot restore test is ready." << '\n';
    }
    board->print();
    return 0;
}
